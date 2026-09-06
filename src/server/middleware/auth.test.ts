import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '../../test/prisma-mock';
import {
  type AuthContext,
  checkSessionValidity,
  extractAuthContext,
  isOrgAdmin,
  requireAuth,
  requireOrgRole,
  requirePlatformAdmin,
  requireTeamMember,
  requireTeamOwner,
} from './auth';

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

describe('isOrgAdmin', () => {
  const ctx = (orgRole: string | null, orgId: string | null = 'org-1') => ({
    orgId,
    orgRole,
    userId: 'user-1',
  });

  it('is true for owner and admin, false for everyone else', () => {
    expect(isOrgAdmin(ctx('owner'))).toBe(true);
    expect(isOrgAdmin(ctx('admin'))).toBe(true);
    expect(isOrgAdmin(ctx('member'))).toBe(false);
    expect(isOrgAdmin(ctx(null))).toBe(false);
  });

  it('is false without an org, whatever the stale role says', () => {
    expect(isOrgAdmin(ctx('owner', null))).toBe(false);
  });
});

describe('requireOrgRole', () => {
  const ctx = (orgRole: string | null, orgId: string | null = 'org-1') => ({
    orgId,
    orgRole,
    userId: 'user-1',
  });

  it("returns the caller's actual role, not just a pass/fail", () => {
    // An owner and an admin both clear ['owner', 'admin'], and only one of
    // them may touch ownership — so the membership-management mutations need
    // to tell them apart after the allow-list has passed.
    expect(requireOrgRole(ctx('admin'), ['owner', 'admin'])).toBe('admin');
    expect(requireOrgRole(ctx('owner'), ['owner', 'admin'])).toBe('owner');
  });

  it('throws FORBIDDEN when the role is not in the allow-list', () => {
    expect(() => requireOrgRole(ctx('member'), ['owner', 'admin'])).toThrow(GraphQLError);
    try {
      requireOrgRole(ctx('member'), ['owner', 'admin']);
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('fails closed when the session carries no role', () => {
    // No membership, or a membership that failed revalidation this request.
    expect(() => requireOrgRole(ctx(null), ['owner', 'admin'])).toThrow(GraphQLError);
    expect(() => requireOrgRole(ctx(null), ['member'])).toThrow(GraphQLError);
  });

  it('fails closed when orgId was dropped but a stale role lingers', () => {
    // Defence in depth for the AuthContext invariant: `orgId` and `orgRole`
    // are cleared together, so a role without an org can only mean the pair
    // got out of sync. Authorizing on it would grant access to a workspace
    // the session no longer holds.
    expect(() => requireOrgRole(ctx('owner', null), ['owner'])).toThrow(GraphQLError);
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

describe('requirePlatformAdmin', () => {
  const prisma = createMockPrisma();

  beforeEach(() => {
    prisma.user.findUnique.mockReset();
  });

  function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
    return {
      apiKeyScopes: null,
      impersonatorId: null,
      orgId: 'org-1',
      userId: 'user-1',
      ...overrides,
    };
  }

  it('throws UNAUTHENTICATED when there is no user', async () => {
    try {
      await requirePlatformAdmin(prisma as never, ctx({ userId: null }));
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
    }
  });

  it('throws FORBIDDEN while impersonating, without hitting the DB', async () => {
    try {
      await requirePlatformAdmin(prisma as never, ctx({ impersonatorId: 'admin-1' }));
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN when the user lacks the platform-admin flag', async () => {
    prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: false });
    try {
      await requirePlatformAdmin(prisma as never, ctx());
      expect.unreachable('Should have thrown');
    } catch (e) {
      expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('returns the userId for a genuine platform admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: true });
    await expect(requirePlatformAdmin(prisma as never, ctx())).resolves.toBe('user-1');
  });
});

describe('checkSessionValidity', () => {
  const activeUser = { active: true };
  const liveOrg = { archivedAt: null, suspendedAt: null };
  const member = { role: 'member' };

  it('is valid when the user is active, the org is live, and membership holds', () => {
    expect(checkSessionValidity(activeUser, liveOrg, member)).toEqual({ valid: true });
  });

  it('fails closed on a missing user, org, or membership row', () => {
    expect(checkSessionValidity(null, liveOrg, member).valid).toBe(false);
    expect(checkSessionValidity(activeUser, null, member).valid).toBe(false);
    expect(checkSessionValidity(activeUser, liveOrg, null).valid).toBe(false);
    expect(checkSessionValidity(undefined, undefined, undefined).valid).toBe(false);
  });

  it('reports membership loss distinctly from suspension', () => {
    // The reasons are not interchangeable: `extractAuthContext` logs them,
    // and "org suspended" vs "you were removed" are different operational
    // events even though both drop the same `orgId`.
    expect(checkSessionValidity(activeUser, liveOrg, null).reason).toMatch(/member/);
    expect(
      checkSessionValidity(activeUser, { archivedAt: null, suspendedAt: new Date() }, member)
        .reason,
    ).toMatch(/suspended/);
  });

  it('checks the user before the org before the membership', () => {
    // Order matters for the reason string a caller acts on: a deactivated
    // user is a full sign-out, an unusable org only drops the org.
    expect(checkSessionValidity({ active: false }, null, null).reason).toMatch(/deactivated/);
    expect(checkSessionValidity(activeUser, null, null).reason).toMatch(/suspended|archived/);
  });
});

describe('extractAuthContext org membership', () => {
  const ORG_ID = '00000000-0000-0000-0000-0000000000a1';
  const USER_ID = '00000000-0000-0000-0000-0000000000b1';

  async function accessTokenFor(orgId: string, userId: string) {
    const { signAccessToken } = await import('../lib/jwt');
    return signAccessToken({ orgId, userId });
  }

  function mockPrismaForSession(membership: { role: string } | null) {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ active: true });
    // The membership is fetched with its organization in one read.
    prisma.organizationMember.findUnique.mockResolvedValue(
      membership && { ...membership, organization: { archivedAt: null, suspendedAt: null } },
    );
    return prisma;
  }

  it('keeps orgId when the signed claim is backed by a live membership', async () => {
    const prisma = mockPrismaForSession({ role: 'member' });
    const token = await accessTokenFor(ORG_ID, USER_ID);

    const ctx = await extractAuthContext(null, token, prisma as never);

    expect(ctx).toMatchObject({ orgId: ORG_ID, userId: USER_ID });
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      select: {
        organization: { select: { archivedAt: true, suspendedAt: true } },
        role: true,
      },
      where: { organizationId_userId: { organizationId: ORG_ID, userId: USER_ID } },
    });
  });

  it('drops orgId — but not the session — once the membership is gone', async () => {
    // The token is still signed, unexpired, and names a healthy org; only
    // the membership behind it was revoked. Before this check the claim was
    // taken at face value for the rest of its 24h life. `userId` survives so
    // the user can still list and switch into their other workspaces.
    const prisma = mockPrismaForSession(null);
    const token = await accessTokenFor(ORG_ID, USER_ID);

    const ctx = await extractAuthContext(null, token, prisma as never);

    expect(ctx.orgId).toBeNull();
    expect(ctx.userId).toBe(USER_ID);
  });
});

describe('extractAuthContext API keys', () => {
  const ORG_ID = '00000000-0000-0000-0000-0000000000a2';
  const USER_ID = '00000000-0000-0000-0000-0000000000b2';

  it('resolves the org from the key itself, not the user’s oldest membership', async () => {
    const prisma = createMockPrisma();
    prisma.authToken.findFirst.mockResolvedValue({
      id: 'token-1',
      organizationId: ORG_ID,
      scopes: ['read'],
      userId: USER_ID,
    });
    prisma.authToken.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organizationMember.findUnique.mockResolvedValue({
      organization: { archivedAt: null, suspendedAt: null },
      role: 'member',
    });

    const ctx = await extractAuthContext(null, 'bil_deadbeef', prisma as never);

    expect(ctx).toMatchObject({ apiKeyScopes: ['read'], orgId: ORG_ID, userId: USER_ID });
  });

  it('refuses to guess an org for a key that carries none', async () => {
    // Legacy keys (created before the column existed) have a null org. The
    // old code substituted the user's first membership, which for a
    // multi-org account silently pointed the key at the wrong tenant —
    // resolving to no org at all is the safe reading.
    const prisma = createMockPrisma();
    prisma.authToken.findFirst.mockResolvedValue({
      id: 'token-1',
      organizationId: null,
      scopes: [],
      userId: USER_ID,
    });
    prisma.authToken.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ active: true });

    const ctx = await extractAuthContext(null, 'bil_deadbeef', prisma as never);

    expect(ctx.orgId).toBeNull();
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('disarms a key whose owner was removed from the key’s org', async () => {
    const prisma = createMockPrisma();
    prisma.authToken.findFirst.mockResolvedValue({
      id: 'token-1',
      organizationId: ORG_ID,
      scopes: ['read', 'write'],
      userId: USER_ID,
    });
    prisma.authToken.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ active: true });
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    const ctx = await extractAuthContext(null, 'bil_deadbeef', prisma as never);

    expect(ctx.orgId).toBeNull();
  });
});
