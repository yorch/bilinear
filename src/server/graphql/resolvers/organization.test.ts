import type { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '@/test/context-mock';
import { TEST_ORG, TEST_USER } from '@/test/fixtures';
import { organizationResolvers } from './organization';

const OTHER_ORG = {
  ...TEST_ORG,
  id: '00000000-0000-0000-0000-0000000000f2',
  name: 'Contractors',
  urlKey: 'contractors',
};

function codeOf(err: unknown): unknown {
  return (err as GraphQLError).extensions?.code;
}

describe('organizationSwitch', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('re-issues the session against another org the user belongs to', async () => {
    ctx.prisma.organizationMember.findFirst.mockResolvedValue({
      organization: OTHER_ORG,
      role: 'member',
    });

    const result = await organizationResolvers.Mutation.organizationSwitch(
      null,
      { organizationId: OTHER_ORG.id },
      ctx as never,
    );

    expect(result.success).toBe(true);
    expect(result.organization).toEqual(OTHER_ORG);
    // Fresh tokens are the whole point — the session's tenant lives in the
    // signed `orgId` claim, so a payload without them would leave the client
    // navigating to a workspace it is still not authenticated for.
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('refuses an org the caller is not a member of', async () => {
    // The only authorization on this mutation. Without it any authenticated
    // user could mint themselves a session for an arbitrary org id.
    ctx.prisma.organizationMember.findFirst.mockResolvedValue(null);

    await expect(
      organizationResolvers.Mutation.organizationSwitch(
        null,
        { organizationId: OTHER_ORG.id },
        ctx as never,
      ),
    ).rejects.toSatisfy(err => codeOf(err) === 'NOT_FOUND');
  });

  it('scopes the membership lookup to enterable orgs', async () => {
    ctx.prisma.organizationMember.findFirst.mockResolvedValue({
      organization: OTHER_ORG,
      role: 'member',
    });

    await organizationResolvers.Mutation.organizationSwitch(
      null,
      { organizationId: OTHER_ORG.id },
      ctx as never,
    );

    expect(ctx.prisma.organizationMember.findFirst).toHaveBeenCalledWith({
      include: { organization: true },
      where: {
        organization: { archivedAt: null, suspendedAt: null },
        organizationId: OTHER_ORG.id,
        userId: TEST_USER.id,
      },
    });
  });

  it('works from a session whose current org was revoked', async () => {
    // `extractAuthContext` drops `orgId` when the org is suspended or the
    // membership is gone, leaving `userId` intact. That session must still
    // be able to switch — it is the only way out.
    const orphaned = createMockContext({ orgId: null });
    orphaned.prisma.organizationMember.findFirst.mockResolvedValue({
      organization: OTHER_ORG,
      role: 'member',
    });

    const result = await organizationResolvers.Mutation.organizationSwitch(
      null,
      { organizationId: OTHER_ORG.id },
      orphaned as never,
    );

    expect(result.success).toBe(true);
  });

  it('refuses while impersonating', async () => {
    const impersonated = createMockContext();
    (impersonated as { impersonatorId?: string }).impersonatorId = 'admin-1';
    impersonated.prisma.organizationMember.findFirst.mockResolvedValue({
      organization: OTHER_ORG,
      role: 'member',
    });

    await expect(
      organizationResolvers.Mutation.organizationSwitch(
        null,
        { organizationId: OTHER_ORG.id },
        impersonated as never,
      ),
    ).rejects.toSatisfy(err => codeOf(err) === 'FORBIDDEN');
  });
});

describe('viewerOrganizations', () => {
  it('flags the session org as current and passes through roles', async () => {
    const ctx = createMockContext();
    ctx.prisma.organizationMember.findMany.mockResolvedValue([
      { organization: TEST_ORG, role: 'owner' },
      { organization: OTHER_ORG, role: 'guest' },
    ]);

    const result = await organizationResolvers.Query.viewerOrganizations(null, {}, ctx as never);

    expect(result).toEqual([
      {
        current: true,
        id: TEST_ORG.id,
        logoUrl: TEST_ORG.logoUrl,
        name: TEST_ORG.name,
        role: 'owner',
        urlKey: TEST_ORG.urlKey,
      },
      {
        current: false,
        id: OTHER_ORG.id,
        logoUrl: OTHER_ORG.logoUrl,
        name: OTHER_ORG.name,
        role: 'guest',
        urlKey: OTHER_ORG.urlKey,
      },
    ]);
  });

  it('resolves for a session with no active org', async () => {
    const ctx = createMockContext({ orgId: null });
    ctx.prisma.organizationMember.findMany.mockResolvedValue([
      { organization: OTHER_ORG, role: 'member' },
    ]);

    const result = await organizationResolvers.Query.viewerOrganizations(null, {}, ctx as never);

    expect(result).toHaveLength(1);
    expect(result[0]?.current).toBe(false);
  });
});

describe('organization query', () => {
  it('reads the session org rather than the user’s oldest membership', async () => {
    // The bug this replaced: a multi-org user working in their second
    // workspace saw their first workspace's settings.
    const ctx = createMockContext();
    ctx.prisma.organization.findUnique.mockResolvedValue(TEST_ORG);

    const result = await organizationResolvers.Query.organization(null, {}, ctx as never);

    expect(result).toEqual(TEST_ORG);
    expect(ctx.prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: TEST_ORG.id },
    });
    expect(ctx.prisma.organizationMember.findFirst).not.toHaveBeenCalled();
  });
});

describe('organizationLeave', () => {
  function ctxLeaving(role: string, opts: { otherOwners?: number; nextOrg?: unknown } = {}) {
    const ctx = createMockContext({ orgRole: role });
    ctx.prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm1', role });
    ctx.prisma.organizationMember.count.mockResolvedValue(opts.otherOwners ?? 0);
    ctx.prisma.teamMembership.deleteMany.mockResolvedValue({ count: 2 });
    ctx.prisma.organizationMember.delete.mockResolvedValue({ id: 'm1', role });
    ctx.prisma.organizationMember.findFirst.mockResolvedValue(
      opts.nextOrg === undefined ? null : opts.nextOrg,
    );
    return ctx;
  }

  it('lets an ordinary member leave, cascading their team memberships', async () => {
    const ctx = ctxLeaving('member');
    const sync = vi.spyOn(ctx.services.sync, 'createSyncAction');

    const result = await organizationResolvers.Mutation.organizationLeave(null, {}, ctx as never);

    expect(result.success).toBe(true);
    // Team rows go in the same transaction as the org membership: a user
    // holding team rows in an org they have left is a state every team query
    // would otherwise have to defend against.
    expect(ctx.prisma.teamMembership.deleteMany).toHaveBeenCalledWith({
      where: { team: { organizationId: TEST_ORG.id }, userId: TEST_USER.id },
    });
    expect(ctx.prisma.organizationMember.delete).toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith(
      TEST_ORG.id,
      'D',
      'OrganizationMember',
      'm1',
      expect.anything(),
    );
  });

  it('hands back an org-less session when nothing remains', async () => {
    const ctx = ctxLeaving('member');
    const result = await organizationResolvers.Mutation.organizationLeave(null, {}, ctx as never);

    // Null organization is the point of the separate payload type: leaving
    // your last workspace lands you nowhere, and the session must still
    // authenticate for viewerOrganizations and workspace creation.
    expect(result.organization).toBeNull();
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('re-issues into a remaining workspace, resolved after the delete', async () => {
    const ctx = ctxLeaving('member', { nextOrg: { organization: OTHER_ORG } });
    const result = await organizationResolvers.Mutation.organizationLeave(null, {}, ctx as never);

    expect(result.organization).toMatchObject({ id: OTHER_ORG.id });
    // Resolved through the same usable-org filter login uses, so it can
    // neither return the org just left nor a suspended one.
    expect(ctx.prisma.organizationMember.findFirst).toHaveBeenCalled();
  });

  it('refuses to strand the workspace when the caller is the last owner', async () => {
    const ctx = ctxLeaving('owner', { otherOwners: 0 });

    await expect(
      organizationResolvers.Mutation.organizationLeave(null, {}, ctx as never),
    ).rejects.toSatisfy(err => codeOf(err) === 'BAD_USER_INPUT');
    expect(ctx.prisma.organizationMember.delete).not.toHaveBeenCalled();
  });

  it('lets an owner leave once another owner exists', async () => {
    const ctx = ctxLeaving('owner', { otherOwners: 1 });

    const result = await organizationResolvers.Mutation.organizationLeave(null, {}, ctx as never);
    expect(result.success).toBe(true);
  });

  it('refuses while impersonating', async () => {
    // An admin acting as someone else must not be able to drop that person
    // out of a workspace — the audit trail records the admin entering, not
    // a membership change made in their name.
    const ctx = ctxLeaving('member');
    ctx.impersonatorId = 'admin-1';

    await expect(
      organizationResolvers.Mutation.organizationLeave(null, {}, ctx as never),
    ).rejects.toSatisfy(err => codeOf(err) === 'FORBIDDEN');
    expect(ctx.prisma.organizationMember.delete).not.toHaveBeenCalled();
  });
});

describe('organizationMemberRemove', () => {
  const TARGET = '00000000-0000-0000-0000-0000000000c1';

  function ctxWithActor(role: string, targetRole = 'member') {
    // The actor's role rides the context now (AuthContext.orgRole), so the
    // single findUnique mock is unambiguously the *target's* row — it used to
    // be a two-call sequence where the first stood in for requireOrgRole.
    const ctx = createMockContext({ orgRole: role });
    ctx.prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm2', role: targetRole });
    ctx.prisma.teamMembership.deleteMany.mockResolvedValue({ count: 0 });
    ctx.prisma.organizationMember.delete.mockResolvedValue({ id: 'm2', role: targetRole });
    return ctx;
  }

  it('removes the member and emits a delete SyncAction', async () => {
    const ctx = ctxWithActor('admin');
    const sync = vi.spyOn(ctx.services.sync, 'createSyncAction');

    const result = await organizationResolvers.Mutation.organizationMemberRemove(
      null,
      { userId: TARGET },
      ctx as never,
    );

    expect(result.success).toBe(true);
    // 'D' so connected clients drop the row rather than keeping a stale one.
    expect(sync).toHaveBeenCalledWith(
      TEST_ORG.id,
      'D',
      'OrganizationMember',
      expect.any(String),
      expect.anything(),
    );
  });

  it('rejects a caller who is only a member', async () => {
    // The role now rides the request context (AuthContext.orgRole), resolved
    // once by extractAuthContext — requireOrgRole no longer re-queries it.
    const ctx = createMockContext({ orgRole: 'member' });

    await expect(
      organizationResolvers.Mutation.organizationMemberRemove(
        null,
        { userId: TARGET },
        ctx as never,
      ),
    ).rejects.toSatisfy(err => codeOf(err) === 'FORBIDDEN');
  });

  it('maps self-removal to BAD_USER_INPUT', async () => {
    const ctx = createMockContext();
    ctx.prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });

    await expect(
      organizationResolvers.Mutation.organizationMemberRemove(
        null,
        { userId: TEST_USER.id },
        ctx as never,
      ),
    ).rejects.toSatisfy(err => codeOf(err) === 'BAD_USER_INPUT');
  });
});

describe('organizationInviteAccept', () => {
  it('joins the org and re-issues the session against it', async () => {
    const ctx = createMockContext({ orgId: null });
    ctx.prisma.user.findUnique.mockResolvedValue({ email: 'invited@example.com' });
    ctx.prisma.organizationInvite.findFirst.mockResolvedValue({
      email: 'invited@example.com',
      id: 'invite-1',
      organization: OTHER_ORG,
      organizationId: OTHER_ORG.id,
      role: 'member',
    });
    ctx.prisma.organizationInvite.updateMany.mockResolvedValue({ count: 1 });
    ctx.prisma.organizationMember.upsert.mockResolvedValue({});

    const result = await organizationResolvers.Mutation.organizationInviteAccept(
      null,
      { token: 'raw-token' },
      ctx as never,
    );

    expect(result.success).toBe(true);
    expect(result.organization).toEqual(OTHER_ORG);
    // A brand-new account has no org at all, so the tokens are what actually
    // land them in the workspace they just joined.
    expect(result.accessToken).toBeTruthy();
  });

  it('surfaces an email mismatch as FORBIDDEN', async () => {
    const ctx = createMockContext({ orgId: null });
    ctx.prisma.user.findUnique.mockResolvedValue({ email: 'someone-else@example.com' });
    ctx.prisma.organizationInvite.findFirst.mockResolvedValue({
      email: 'invited@example.com',
      id: 'invite-1',
      organization: OTHER_ORG,
      organizationId: OTHER_ORG.id,
      role: 'member',
    });

    await expect(
      organizationResolvers.Mutation.organizationInviteAccept(
        null,
        { token: 'raw-token' },
        ctx as never,
      ),
    ).rejects.toSatisfy(err => codeOf(err) === 'FORBIDDEN');
  });
});

describe('organizationInvites query', () => {
  it('is owner/admin only', async () => {
    const ctx = createMockContext({ orgRole: 'member' });

    await expect(
      organizationResolvers.Query.organizationInvites(null, {}, ctx as never),
    ).rejects.toSatisfy(err => codeOf(err) === 'FORBIDDEN');
  });
});
