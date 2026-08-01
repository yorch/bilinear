import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PrismaClient, PublicRoadmap } from '../../generated/prisma';
import { ProjectService } from './project.service';

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

  async upsert(orgId: string, urlKey: string, input: RoadmapUpsertInput): Promise<PublicRoadmap> {
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
    return verifyRoadmapPassword(roadmap.passwordHash, password);
  }
}
