import { isLocale } from '@/lib/i18n';
import type { PrismaClient, User } from '../../generated/prisma';

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

  async getOrganizationForUser(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
      where: { userId },
    });

    return membership?.organization ?? null;
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
}

export class InvalidLocaleError extends Error {
  constructor(locale: string) {
    super(`Unsupported locale: ${locale}`);
    this.name = 'InvalidLocaleError';
  }
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
