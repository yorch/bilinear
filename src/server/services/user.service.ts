import type { PrismaClient, User } from '../../generated/prisma';

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
    avatarUrl?: string;
  }): Promise<User> {
    const existing = await this.prisma.user.findUnique({
      where: { email: params.email },
    });

    if (existing) {
      // Update googleId / avatar if linking OAuth
      if (params.googleId && !existing.googleId) {
        return this.prisma.user.update({
          data: {
            avatarUrl: params.avatarUrl ?? existing.avatarUrl,
            googleId: params.googleId,
          },
          where: { id: existing.id },
        });
      }
      return existing;
    }

    const initials = deriveInitials(params.name);

    return this.prisma.user.create({
      data: {
        avatarUrl: params.avatarUrl,
        displayName: params.name,
        email: params.email,
        googleId: params.googleId,
        initials,
        name: params.name,
      },
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
  async updateLastSeen(
    userId: string,
    currentLastSeen: Date | null,
  ): Promise<void> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (currentLastSeen && currentLastSeen > fiveMinutesAgo) {
      return;
    }
    await this.prisma.user.update({
      data: { lastSeen: new Date() },
      where: { id: userId },
    });
  }
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
