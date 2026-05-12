import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '../../test/prisma-mock';
import { requireAuth, requireOrgRole, requireTeamMember, requireTeamOwner } from './auth';

describe('requireAuth', () => {
  it('throws UNAUTHENTICATED when both userId and orgId are null', () => {
    const ctx = { orgId: null, userId: null };
    expect(() => requireAuth(ctx)).toThrow(GraphQLError);
    try {
      requireAuth(ctx);
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('throws UNAUTHENTICATED when userId is null but orgId is present', () => {
    const ctx = { orgId: 'org-1', userId: null };
    try {
      requireAuth(ctx);
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('throws UNAUTHENTICATED when userId is present but orgId is null', () => {
    const ctx = { orgId: null, userId: 'user-1' };
    try {
      requireAuth(ctx);
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('does not throw when both userId and orgId are present', () => {
    const ctx = { orgId: 'org-1', userId: 'user-1' };
    expect(() => requireAuth(ctx)).not.toThrow();
  });
});

describe('requireOrgRole', () => {
  const prisma = createMockPrisma();

  beforeEach(() => {
    prisma.organizationMember.findUnique.mockReset();
  });

  it('passes when user has required role', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({
      id: 'mem-1',
      organizationId: 'org-1',
      role: 'admin',
      userId: 'user-1',
    });

    await expect(
      requireOrgRole(prisma as never, 'org-1', 'user-1', ['owner', 'admin']),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when user has wrong role', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({
      id: 'mem-1',
      organizationId: 'org-1',
      role: 'member',
      userId: 'user-1',
    });

    try {
      await requireOrgRole(prisma as never, 'org-1', 'user-1', ['owner', 'admin']);
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('throws FORBIDDEN when membership does not exist', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    try {
      await requireOrgRole(prisma as never, 'org-1', 'user-1', ['owner', 'admin']);
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });
});

describe('requireTeamMember', () => {
  const prisma = createMockPrisma();

  beforeEach(() => {
    prisma.teamMembership.findUnique.mockReset();
  });

  it('passes when user is a team member in the active org', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: false,
      team: { organizationId: 'org-1' },
      teamId: 'team-1',
      userId: 'user-1',
    });

    await expect(
      requireTeamMember(prisma as never, 'team-1', 'user-1', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when team belongs to a different org', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: false,
      team: { organizationId: 'org-1' },
      teamId: 'team-1',
      userId: 'user-1',
    });

    try {
      await requireTeamMember(prisma as never, 'team-1', 'user-1', 'org-other');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('throws FORBIDDEN when user is not a member', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue(null);

    try {
      await requireTeamMember(prisma as never, 'team-1', 'user-1', 'org-1');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });
});

describe('requireTeamOwner', () => {
  const prisma = createMockPrisma();

  beforeEach(() => {
    prisma.teamMembership.findUnique.mockReset();
  });

  it('passes when user is a team owner', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: true,
      team: { organizationId: 'org-1' },
      teamId: 'team-1',
      userId: 'user-1',
    });

    await expect(
      requireTeamOwner(prisma as never, 'team-1', 'user-1', 'org-1'),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when user is a member but not owner', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: false,
      team: { organizationId: 'org-1' },
      teamId: 'team-1',
      userId: 'user-1',
    });

    try {
      await requireTeamOwner(prisma as never, 'team-1', 'user-1', 'org-1');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('throws FORBIDDEN when team belongs to a different org', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: true,
      team: { organizationId: 'org-1' },
      teamId: 'team-1',
      userId: 'user-1',
    });

    try {
      await requireTeamOwner(prisma as never, 'team-1', 'user-1', 'org-other');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('throws FORBIDDEN when user has no membership', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue(null);

    try {
      await requireTeamOwner(prisma as never, 'team-1', 'user-1', 'org-1');
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphQLError);
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });
});
