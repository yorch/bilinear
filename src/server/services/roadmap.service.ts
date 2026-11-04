import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PrismaClient, PublicRoadmap } from '../../generated/prisma';
import { getSecretBytes } from '../lib/jwt';
import { childLogger } from '../lib/logger';
import { checkFixedWindow } from '../middleware/rate-limit';
import { ProjectService } from './project.service';

const log = childLogger({ module: 'roadmap' });

export interface RoadmapUpsertInput {
  description?: string;
  enabled?: boolean;
  password?: string; // plain text — will be hashed; empty string clears password
  slug?: string;
  title?: string;
}

export class RoadmapNotFoundError extends Error {
  constructor() {
    super('Roadmap not found');
    this.name = 'RoadmapNotFoundError';
  }
}

export class RoadmapPasswordError extends Error {
  constructor() {
    super('Invalid password');
    this.name = 'RoadmapPasswordError';
  }
}

export class RoadmapSlugInvalidError extends Error {
  constructor() {
    super('Slug may only contain lowercase letters, numbers and hyphens (max 63 characters)');
    this.name = 'RoadmapSlugInvalidError';
  }
}

export class RoadmapSlugConflictError extends Error {
  constructor() {
    super('A roadmap with this slug already exists');
    this.name = 'RoadmapSlugConflictError';
  }
}

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

// Stores as "salt:derivedKeyHex" using scrypt (memory-hard, timing-safe)
export async function hashRoadmapPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

export async function verifyRoadmapPassword(stored: string, candidate: string): Promise<boolean> {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) {
    return false;
  }
  const storedKey = Buffer.from(keyHex, 'hex');
  const candidateKey = (await scryptAsync(candidate, salt, KEY_LEN)) as Buffer;
  return timingSafeEqual(storedKey, candidateKey);
}

/** Slugs are URL segments and part of the unlock cookie name, so keep them cookie-safe. */
const ROADMAP_SLUG_PATTERN = /^[a-z0-9-]{1,63}$/;
export const isValidRoadmapSlug = (slug: string) => ROADMAP_SLUG_PATTERN.test(slug);

/** Longest password we will run through scrypt — a cap on per-request CPU. */
export const MAX_ROADMAP_PASSWORD_LENGTH = 256;

export const ROADMAP_UNLOCK_TTL_SECONDS = 60 * 60 * 24 * 7;
const ROADMAP_ATTEMPTS_PER_IP = 10;
/**
 * Backstop for the whole roadmap. Also the only limiter when the client IP is
 * unknown (no TRUST_PROXY_HEADERS), so it is generous enough that one visitor
 * cannot lock everyone out with a handful of junk POSTs but still bounds scrypt.
 */
const ROADMAP_ATTEMPTS_PER_ROADMAP = 600;
const ROADMAP_ATTEMPT_WINDOW_SECONDS = 15 * 60;

let warnedUnknownIp = false;
/** Test hook: re-arm the once-only unknown-IP warning. */
export const resetUnknownIpWarning = () => {
  warnedUnknownIp = false;
};

/** Cookie that carries a visitor's proof of having entered the roadmap password. */
export const roadmapUnlockCookieName = (slug: string) => `roadmap_unlock_${slug}`;

function unlockSignature(
  slug: string,
  passwordHash: string,
  expiresAt: number,
  secret?: string,
): string {
  const key = secret ?? getSecretBytes('JWT_SECRET');
  return createHmac('sha256', key)
    .update(`roadmap-unlock:${slug}:${passwordHash}:${expiresAt}`)
    .digest('hex');
}

/**
 * Unlock token stored in an httpOnly cookie after a correct password:
 * `<expiresAtUnixSeconds>.<hmac>`. The HMAC covers the slug, the stored password
 * hash and the expiry, so it never contains the password, stops working the
 * moment the password is changed or removed, and expires server-side (not just
 * in the browser). This replaces `?password=` in the URL, which leaked into
 * history, server logs and Referer headers.
 */
export function roadmapUnlockToken(
  slug: string,
  passwordHash: string,
  secret?: string,
  expiresAt: number = Math.floor(Date.now() / 1000) + ROADMAP_UNLOCK_TTL_SECONDS,
): string {
  return `${expiresAt}.${unlockSignature(slug, passwordHash, expiresAt, secret)}`;
}

export function isRoadmapUnlockTokenValid(
  token: string | undefined,
  slug: string,
  passwordHash: string,
  secret?: string,
): boolean {
  if (!token) {
    return false;
  }
  const dot = token.indexOf('.');
  const expiresAt = Number(token.slice(0, dot));
  if (dot < 1 || !Number.isInteger(expiresAt) || expiresAt <= Date.now() / 1000) {
    return false;
  }
  const expected = Buffer.from(unlockSignature(slug, passwordHash, expiresAt, secret));
  const given = Buffer.from(token.slice(dot + 1));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export class RoadmapService {
  constructor(private prisma: PrismaClient) {}

  async findByOrgId(orgId: string): Promise<PublicRoadmap | null> {
    return this.prisma.publicRoadmap.findUnique({
      where: { organizationId: orgId },
    });
  }

  async findBySlug(slug: string): Promise<PublicRoadmap | null> {
    return this.prisma.publicRoadmap.findUnique({ where: { slug } });
  }

  async getRoadmapProjects(orgId: string, password?: string) {
    const roadmap = await this.findByOrgId(orgId);
    if (!roadmap?.enabled) {
      throw new RoadmapNotFoundError();
    }

    if (roadmap.passwordHash && password) {
      const valid = await verifyRoadmapPassword(roadmap.passwordHash, password);
      if (!valid) {
        throw new RoadmapPasswordError();
      }
    }

    const projects = await this.prisma.project.findMany({
      include: {
        milestones: {
          where: { archivedAt: null },
        },
      },
      where: {
        archivedAt: null,
        organizationId: orgId,
        roadmapVisible: true,
        trashed: false,
      },
    });

    // `Project.progress` is a stored column that nothing ever writes — the real
    // value is computed from the issue set. Reading the column shipped 0% for
    // every project on the public roadmap. `ProjectService` owns the rule.
    const progressById = await new ProjectService(this.prisma).getProgressBatch(
      projects.map(p => p.id),
    );

    return projects.map(p => ({
      color: p.color,
      completedMilestoneCount: 0,
      health: p.health,
      icon: p.icon,
      id: p.id,
      milestoneCount: p.milestones.length,
      name: p.name,
      progress: progressById.get(p.id)?.progress ?? 0,
      statusName: p.statusName,
      statusType: p.statusType,
      targetDate: p.targetDate,
    }));
  }

  /**
   * Count one password attempt against a roadmap and report whether the caller
   * is over the limit. Shared by the GraphQL query and the unlock route so the
   * two entry points cannot drift. Fail-closed: a counter outage must not turn
   * the password check into an unlimited scrypt oracle.
   */
  async isPasswordAttemptLimited(roadmapId: string, ip: string | null): Promise<boolean> {
    if (!ip && !warnedUnknownIp) {
      warnedUnknownIp = true;
      log.warn(
        'Client IP unknown for roadmap password attempt; per-IP limit skipped. Set TRUST_PROXY_HEADERS=1 behind a trusted proxy.',
      );
    }
    // An unknown IP must not share one global per-IP bucket: that would let a
    // single visitor lock every other visitor out. Fall back to the roadmap-wide cap.
    const [perIp, perRoadmap] = await Promise.all([
      ip
        ? checkFixedWindow(
            `rl:roadmap:${roadmapId}:ip:${ip}`,
            ROADMAP_ATTEMPTS_PER_IP,
            ROADMAP_ATTEMPT_WINDOW_SECONDS,
            true,
          )
        : Promise.resolve({ exceeded: false }),
      checkFixedWindow(
        `rl:roadmap:${roadmapId}:all`,
        ROADMAP_ATTEMPTS_PER_ROADMAP,
        ROADMAP_ATTEMPT_WINDOW_SECONDS,
        true,
      ),
    ]);
    return perIp.exceeded || perRoadmap.exceeded;
  }

  async upsert(orgId: string, urlKey: string, input: RoadmapUpsertInput): Promise<PublicRoadmap> {
    if (input.slug !== undefined && !isValidRoadmapSlug(input.slug)) {
      throw new RoadmapSlugInvalidError();
    }
    // Check slug uniqueness if provided
    if (input.slug) {
      const conflict = await this.prisma.publicRoadmap.findFirst({
        where: { organizationId: { not: orgId }, slug: input.slug },
      });
      if (conflict) {
        throw new RoadmapSlugConflictError();
      }
    }

    let passwordHash: string | null | undefined;
    if (input.password !== undefined) {
      passwordHash = input.password === '' ? null : await hashRoadmapPassword(input.password);
    }

    const existing = await this.findByOrgId(orgId);

    if (existing) {
      return this.prisma.publicRoadmap.update({
        data: {
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(passwordHash !== undefined ? { passwordHash } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
        },
        where: { organizationId: orgId },
      });
    }

    // Create with defaults — slug defaults to org urlKey if not provided
    return this.prisma.publicRoadmap.create({
      data: {
        description: input.description,
        enabled: input.enabled ?? false,
        organizationId: orgId,
        ...(passwordHash !== undefined ? { passwordHash } : {}),
        slug: input.slug ?? urlKey,
        title: input.title ?? 'Product Roadmap',
      },
    });
  }

  async verifyPassword(roadmap: PublicRoadmap, password: string): Promise<boolean> {
    if (!roadmap.passwordHash) {
      return true;
    }
    if (password.length > MAX_ROADMAP_PASSWORD_LENGTH) {
      return false;
    }
    return verifyRoadmapPassword(roadmap.passwordHash, password);
  }
}
