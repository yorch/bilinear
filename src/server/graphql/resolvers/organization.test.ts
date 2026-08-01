import type { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
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
