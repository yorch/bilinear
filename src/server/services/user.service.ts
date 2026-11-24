import { isAccent } from '@/lib/accent';
import { isLocale } from '@/lib/i18n';
import type { PrismaClient, User } from '../../generated/prisma';
import { env } from '../lib/env';
import { MAX_LOGO_URL_LENGTH } from '../lib/limits';
import { avatarKeyFromUrl } from './file.service';

/**
 * Whether the given (transaction or root) Prisma client sees an empty users
 * table — i.e. the caller is about to create the very first account, which is
 * bootstrapped as the platform admin. Shared across every user-creation path
 * (magic-link/OAuth via `findOrCreate`, SAML JIT, SCIM) so a fresh deployment
 * always gets exactly one operator regardless of how the first user signs in.
 */
export async function isFirstUser(client: Pick<PrismaClient, 'user'>): Promise<boolean> {
  return (await client.user.count()) === 0;
}

/**
 * "This org can currently be signed into" — the Prisma-`where` twin of
 * `checkSessionValidity`'s org half (src/server/middleware/auth.ts), which
 * evaluates the same rule against an already-fetched row. Both must agree:
 * an org this filter admits but `checkSessionValidity` rejects would let a
 * user switch into a workspace that immediately drops them back out.
 */
const ORG_USABLE_WHERE = { archivedAt: null, suspendedAt: null } as const;

export class UserService {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findOrCreate(params: {
    email: string;
    name: string;
    googleId?: string;
    githubId?: string;
    avatarUrl?: string;
  }): Promise<User> {
    // Provider ids are stable while provider-side emails can change. Match by
    // provider id first so a returning OAuth user whose email changed still
    // lands on their existing account instead of falling through to a create
    // that violates the unique provider-id constraint.
    let existing: User | null = null;
    if (params.githubId) {
      existing = await this.prisma.user.findUnique({ where: { githubId: params.githubId } });
    } else if (params.googleId) {
      existing = await this.prisma.user.findUnique({ where: { googleId: params.googleId } });
    }
    existing ??= await this.prisma.user.findUnique({ where: { email: params.email } });

    if (existing) {
      // Link the provider id on first OAuth sign-in to an existing account.
      const linkGoogle = params.googleId && !existing.googleId;
      const linkGithub = params.githubId && !existing.githubId;
      if (linkGoogle || linkGithub) {
        return this.prisma.user.update({
          data: {
            // Fill the avatar only when the account has none — linking a
            // provider must not clobber an avatar the user already has.
            avatarUrl: existing.avatarUrl ?? params.avatarUrl,
            ...(linkGoogle ? { googleId: params.googleId } : {}),
            ...(linkGithub ? { githubId: params.githubId } : {}),
          },
          where: { id: existing.id },
        });
      }
      return existing;
    }

    const initials = deriveInitials(params.name);

    // Bootstrap: the very first account created in an empty deployment becomes
    // the platform admin, so a fresh install has an operator without any
    // seed/env step. Done inside a transaction so the count and the insert see
    // a consistent view — on the (rare) concurrent-first-signup race the DB
    // may briefly mint two admins, which is acceptable and easily corrected
    // from the console.
    return this.prisma.$transaction(async tx => {
      const platformAdmin = await isFirstUser(tx);
      return tx.user.create({
        data: {
          avatarUrl: params.avatarUrl,
          displayName: params.name,
          email: params.email,
          githubId: params.githubId,
          googleId: params.googleId,
          initials,
          isPlatformAdmin: platformAdmin,
          name: params.name,
        },
      });
    });
  }

  /**
   * The organization a session defaults to when none is specified — the
   * user's oldest *usable* membership.
   *
   * "Usable" is the important qualifier: a membership in an archived or
   * suspended org can't be authenticated into (`extractAuthContext` drops
   * `orgId` for those, and `checkSessionValidity` fails closed on them), so
   * picking one here stranded a multi-org user in a workspace they could
   * not enter — with no way to reach the orgs they *could* use, because the
   * only selector was "oldest membership, full stop". Filtering first means
   * login lands on a workspace that actually opens.
   *
   * Returns null when the user has no usable membership at all; callers
   * treat that as "send to onboarding".
   */
  async getOrganizationForUser(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
      where: { organization: ORG_USABLE_WHERE, userId },
    });

    return membership?.organization ?? null;
  }

  /**
   * Every organization the user can currently sign into, with their role in
   * each. Backs the workspace switcher and the `viewerOrganizations` query.
   *
   * Ordered by name so the switcher list is stable across reloads (creation
   * order is meaningless to the reader, and `updatedAt` would make entries
   * jump around as orgs are edited).
   */
  async listOrganizationsForUser(userId: string) {
    const memberships = await this.prisma.organizationMember.findMany({
      include: { organization: true },
      orderBy: { organization: { name: 'asc' } },
      where: { organization: ORG_USABLE_WHERE, userId },
    });

    return memberships.map(m => ({ organization: m.organization, role: m.role }));
  }

  /**
   * The user's membership row for `orgId`, or null — including null when the
   * org exists but is archived/suspended, so callers can't switch into (or
   * stay in) a workspace that is locked. Used by the per-request membership
   * re-check and by `organizationSwitch`.
   */
  async findUsableMembership(userId: string, orgId: string) {
    return this.prisma.organizationMember.findFirst({
      include: { organization: true },
      where: { organization: ORG_USABLE_WHERE, organizationId: orgId, userId },
    });
  }

  // Only write to the DB if lastSeen is stale (>5 min ago or null),
  // avoiding a write on every viewer query.
  async updateLastSeen(userId: string, currentLastSeen: Date | null): Promise<void> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (currentLastSeen && currentLastSeen > fiveMinutesAgo) {
      return;
    }
    await this.prisma.user.update({
      data: { lastSeen: new Date() },
      where: { id: userId },
    });
  }

  /**
   * Persist the user's language preference so transactional emails (which have
   * no browser locale cookie) can be localized. Ignores unsupported values.
   */
  async updateLocale(userId: string, locale: string): Promise<User> {
    if (!isLocale(locale)) {
      throw new InvalidLocaleError(locale);
    }
    return this.prisma.user.update({ data: { locale }, where: { id: userId } });
  }

  /**
   * Persist the accent preference so it follows the account to a new device.
   * Validated against the registry for the same reason the locale is: a value
   * the CSS has no block for would leave `data-accent` matching nothing.
   */
  async updateAccent(userId: string, accent: string): Promise<User> {
    if (!isAccent(accent)) {
      throw new InvalidAccentError(accent);
    }
    return this.prisma.user.update({ data: { accent }, where: { id: userId } });
  }

  /**
   * Edit the viewer's own profile. `name` is required to be 1-255 characters
   * after control/format characters (zero-width, bidi overrides) are stripped
   * and the result trimmed, and must keep at least one visible character;
   * initials are recomputed from it so the avatar fallback follows a rename.
   * `avatarUrl` is optional: omitted leaves it alone, `null` clears it, and a
   * string must be this app's own `/api/uploads/<avatar key>` URL for a file
   * the caller uploaded as an avatar — the value is broadcast to every
   * workspace and rendered in a raw <img>, so an arbitrary host (internal
   * addresses, tracking pixels) is refused. Re-sending the avatar the account
   * already has (an OAuth provider's picture) is accepted unchanged.
   * `displayName` mirrors `name` — nothing in the product distinguishes them.
   *
   * Returns `changed: false` (and writes nothing) when the input matches the
   * stored profile, so the caller can skip the cross-org SyncAction fan-out.
   * Pass a transaction client to make the write atomic with those SyncActions.
   */
  async updateProfile(
    userId: string,
    input: { avatarUrl?: string | null; name?: string | null },
    client: Pick<PrismaClient, 'file' | 'user'> = this.prisma,
  ): Promise<{ changed: boolean; user: User }> {
    if (input.name === undefined && input.avatarUrl === undefined) {
      throw new InvalidProfileError('Nothing to update');
    }
    const current = await client.user.findUnique({ where: { id: userId } });
    if (!current) {
      throw new InvalidProfileError('User not found');
    }
    const data: {
      avatarUrl?: string | null;
      displayName?: string;
      initials?: string;
      name?: string;
    } = {};
    if (input.name !== undefined) {
      if (typeof input.name !== 'string') {
        throw new InvalidProfileError('Name is required');
      }
      const name = sanitizeProfileName(input.name);
      if (name.length < 1 || name.length > MAX_PROFILE_NAME_LENGTH) {
        throw new InvalidProfileError(`Name must be 1-${MAX_PROFILE_NAME_LENGTH} characters`);
      }
      if (name !== current.name) {
        data.name = name;
        data.displayName = name;
        data.initials = deriveInitials(name);
      }
    }
    if (input.avatarUrl !== undefined && input.avatarUrl !== current.avatarUrl) {
      if (input.avatarUrl !== null) {
        await this.assertOwnAvatar(client, userId, input.avatarUrl);
      }
      data.avatarUrl = input.avatarUrl;
    }
    if (Object.keys(data).length === 0) {
      return { changed: false, user: current };
    }
    const user = await client.user.update({ data, where: { id: userId } });
    return { changed: true, user };
  }

  private async assertOwnAvatar(
    client: Pick<PrismaClient, 'file'>,
    userId: string,
    url: string,
  ): Promise<void> {
    const key = url.length <= MAX_LOGO_URL_LENGTH ? avatarKeyFromUrl(url, env.APP_URL) : null;
    const file = key
      ? await client.file.findFirst({
          select: { id: true },
          where: { issueId: null, key, projectId: null, uploaderId: userId },
        })
      : null;
    if (!file) {
      throw new InvalidProfileError('Avatar must be an image you uploaded');
    }
  }
}

export const MAX_PROFILE_NAME_LENGTH = 255;

export class InvalidProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProfileError';
  }
}

export class InvalidLocaleError extends Error {
  constructor(locale: string) {
    super(`Unsupported locale: ${locale}`);
    this.name = 'InvalidLocaleError';
  }
}

export class InvalidAccentError extends Error {
  constructor(accent: string) {
    super(`Unsupported accent: ${accent}`);
    this.name = 'InvalidAccentError';
  }
}

/** Strip control and format characters (zero-width, bidi overrides), then trim. */
export function sanitizeProfileName(raw: string): string {
  return raw.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
}

// Code points, not UTF-16 units: `[0]` of an emoji is a lone surrogate.
export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = Array.from(parts[0]);
  if (parts.length === 1) {
    return first.slice(0, 2).join('').toUpperCase();
  }
  const last = Array.from(parts[parts.length - 1]);
  return (first[0] + last[0]).toUpperCase();
}
