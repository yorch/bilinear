import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '../../test/prisma-mock';
import {
  requireAuth,
  requireOrgRole,
  requireTeamMember,
  requireTeamOwner,
} from './auth';

describe('requireAuth', () => {
  it('throws UNAUTHENTICATED when userId is null', () => {
    const ctx = { orgId: null, userId: null };
    expect(() => requireAuth(ctx)).toThrow(GraphQLError);
    try {
      requireAuth(ctx);
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('does not throw when userId is present', () => {
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

    await expect(
      requireOrgRole(prisma as never, 'org-1', 'user-1', ['owner', 'admin']),
    ).rejects.toThrow(GraphQLError);
  });

  it('throws FORBIDDEN when membership does not exist', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    await expect(
      requireOrgRole(prisma as never, 'org-1', 'user-1', ['owner', 'admin']),
    ).rejects.toThrow(GraphQLError);
  });
});

describe('requireTeamMember', () => {
  const prisma = createMockPrisma();

  beforeEach(() => {
    prisma.teamMembership.findUnique.mockReset();
  });

  it('passes when user is a team member', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: false,
      teamId: 'team-1',
      userId: 'user-1',
    });

    await expect(
      requireTeamMember(prisma as never, 'team-1', 'user-1'),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when user is not a member', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue(null);

    await expect(
      requireTeamMember(prisma as never, 'team-1', 'user-1'),
    ).rejects.toThrow(GraphQLError);
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
      teamId: 'team-1',
      userId: 'user-1',
    });

    await expect(
      requireTeamOwner(prisma as never, 'team-1', 'user-1'),
    ).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when user is a member but not owner', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue({
      id: 'tm-1',
      isOwner: false,
      teamId: 'team-1',
      userId: 'user-1',
    });

    await expect(
      requireTeamOwner(prisma as never, 'team-1', 'user-1'),
    ).rejects.toThrow(GraphQLError);
  });

  it('throws FORBIDDEN when user has no membership', async () => {
    prisma.teamMembership.findUnique.mockResolvedValue(null);

    await expect(
      requireTeamOwner(prisma as never, 'team-1', 'user-1'),
    ).rejects.toThrow(GraphQLError);
  });
});
