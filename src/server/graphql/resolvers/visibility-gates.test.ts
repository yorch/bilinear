import { beforeEach, describe, expect, it } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM } from '../../../test/fixtures';
import { CustomViewService } from '../../services/custom-view.service';
import { FavoriteService } from '../../services/favorite.service';
import { IssueRelationService } from '../../services/issue-relation.service';
import { customViewResolvers } from './custom-view';
import { favoriteResolvers } from './favorite';
import { issueActivityResolvers } from './issue-activity';
import { issueRelationResolvers } from './issue-relation';
import { notificationResolvers } from './notification';

/**
 * Reads keyed by an id must apply the caller's CURRENT visibility, not just
 * "same organization": a private team's rows are addressable by anyone who
 * learns the id.
 */

const PRIVATE_TEAM = '00000000-0000-0000-0000-0000000000f9';
const SECRET_ISSUE = { ...TEST_ISSUE, id: 'secret-issue', teamId: PRIVATE_TEAM };

type Ctx = MockGraphQLContext & {
  services: MockGraphQLContext['services'] & {
    customView: CustomViewService;
    favorite: FavoriteService;
    issueRelation: IssueRelationService;
  };
};

function makeCtx(): Ctx {
  const base = createMockContext();
  const ctx = {
    ...base,
    services: {
      ...base.services,
      customView: new CustomViewService(base.prisma as never),
      favorite: new FavoriteService(base.prisma as never),
      issueRelation: new IssueRelationService(base.prisma as never),
    },
  } as Ctx;
  ctx.prisma.team.findMany.mockResolvedValue([]);
  ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);
  return ctx;
}

/** The caller is a member of every team EXCEPT the private one, which they cannot see. */
function outsideThePrivateTeam(ctx: Ctx) {
  ctx.prisma.team.findMany.mockResolvedValue([
    { id: PRIVATE_TEAM, memberships: [], organizationId: TEST_ORG.id },
  ]);
  ctx.prisma.teamMembership.findUnique.mockImplementation(
    async ({ where }: { where: { teamId_userId: { teamId: string } } }) =>
      where.teamId_userId.teamId === PRIVATE_TEAM
        ? null
        : { team: { organizationId: TEST_ORG.id } },
  );
}

describe('issueActivities', () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = makeCtx();
    ctx.prisma.issue.findUnique.mockResolvedValue(SECRET_ISSUE);
    ctx.prisma.issueActivity.findMany.mockResolvedValue([
      { field: 'title', id: 'a1', issueId: SECRET_ISSUE.id, newValue: 'new', oldValue: 'old' },
    ]);
  });

  it('refuses a non-member of the issue team (org membership is not access)', async () => {
    outsideThePrivateTeam(ctx);
    await expect(
      issueActivityResolvers.Query.issueActivities(
        null,
        { issueId: SECRET_ISSUE.id },
        ctx as never,
      ),
    ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    expect(ctx.prisma.issueActivity.findMany).not.toHaveBeenCalled();
  });

  it('refuses a guest on an issue they neither created nor are assigned to', async () => {
    ctx.prisma.issue.findUnique.mockResolvedValue({
      ...TEST_ISSUE,
      assigneeId: null,
      creatorId: 'someone-else',
    });
    ctx.prisma.teamMembership.findUnique.mockResolvedValue({
      team: { organizationId: TEST_ORG.id },
    });
    ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });
    await expect(
      issueActivityResolvers.Query.issueActivities(null, { issueId: TEST_ISSUE.id }, ctx as never),
    ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });

  it('returns the history to a member', async () => {
    ctx.prisma.teamMembership.findUnique.mockResolvedValue({
      team: { organizationId: TEST_ORG.id },
    });
    ctx.prisma.teamMemberRole.findUnique.mockResolvedValue(null);
    const rows = await issueActivityResolvers.Query.issueActivities(
      null,
      { issueId: SECRET_ISSUE.id },
      ctx as never,
    );
    expect(rows).toHaveLength(1);
  });

  it('redacts the private team key from a team-move entry for a viewer outside that team', async () => {
    // Issue now lives in a public team; it LEFT private team SSX.
    ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
    ctx.prisma.teamMembership.findUnique.mockResolvedValue({
      team: { organizationId: TEST_ORG.id },
    });
    ctx.prisma.team.findMany.mockImplementation(async (args: { select?: { key?: boolean } }) =>
      args.select?.key
        ? [{ key: 'SSX' }]
        : [{ id: PRIVATE_TEAM, memberships: [], organizationId: TEST_ORG.id }],
    );
    ctx.prisma.issueActivity.findMany.mockResolvedValue([
      { field: 'teamId', id: 'a2', issueId: TEST_ISSUE.id, newValue: 'ENG-87', oldValue: 'SSX-1' },
      { field: 'title', id: 'a3', issueId: TEST_ISSUE.id, newValue: 'SSX-1 ref', oldValue: 'o' },
    ]);
    const rows = (await issueActivityResolvers.Query.issueActivities(
      null,
      { issueId: TEST_ISSUE.id },
      ctx as never,
    )) as Array<{ field: string; newValue: string | null; oldValue: string | null }>;
    expect(rows[0]).toMatchObject({ newValue: 'ENG-87', oldValue: null });
    // Only team-move entries are touched.
    expect(rows[1]?.newValue).toBe('SSX-1 ref');
  });
});

describe('Notification.issue', () => {
  it('is null once the viewer can no longer see the issue (moved into a private team)', async () => {
    const ctx = makeCtx();
    outsideThePrivateTeam(ctx);
    ctx.prisma.issue.findUnique.mockResolvedValue(SECRET_ISSUE);
    const issue = await notificationResolvers.Notification.issue(
      { issueId: SECRET_ISSUE.id } as never,
      {},
      ctx as never,
    );
    expect(issue).toBeNull();
  });

  it('still resolves for a viewer who can see it', async () => {
    const ctx = makeCtx();
    ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
    const issue = await notificationResolvers.Notification.issue(
      { issueId: TEST_ISSUE.id } as never,
      {},
      ctx as never,
    );
    expect(issue).toMatchObject({ id: TEST_ISSUE.id });
  });
});

describe('issueRelations', () => {
  it('refuses a non-member of the issue team', async () => {
    const ctx = makeCtx();
    outsideThePrivateTeam(ctx);
    ctx.prisma.issue.findUnique.mockResolvedValue(SECRET_ISSUE);
    await expect(
      issueRelationResolvers.Query.issueRelations(null, { issueId: SECRET_ISSUE.id }, ctx as never),
    ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
  });

  it('drops relations whose other end the viewer cannot see', async () => {
    const ctx = makeCtx();
    ctx.prisma.team.findMany.mockResolvedValue([
      { id: PRIVATE_TEAM, memberships: [], organizationId: TEST_ORG.id },
    ]);
    ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
    ctx.prisma.teamMembership.findUnique.mockResolvedValue({
      team: { organizationId: TEST_ORG.id },
    });
    ctx.prisma.issueRelation.findMany.mockResolvedValue([
      { id: 'r1', issueId: TEST_ISSUE.id, relatedIssueId: 'secret-issue', type: 'related' },
      { id: 'r2', issueId: TEST_ISSUE.id, relatedIssueId: 'open-issue', type: 'related' },
    ]);
    ctx.prisma.issue.findMany.mockResolvedValue([
      { ...SECRET_ISSUE, id: 'secret-issue' },
      { ...TEST_ISSUE, id: 'open-issue' },
    ]);
    const rows = (await issueRelationResolvers.Query.issueRelations(
      null,
      { issueId: TEST_ISSUE.id },
      ctx as never,
    )) as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['r2']);
  });
});

describe('Favorite.entity', () => {
  const FAV = { entityId: 'secret-issue', entityType: 'Issue', id: 'f1' };

  it('resolves null for an issue that moved into a private team after it was favorited', async () => {
    const ctx = makeCtx();
    outsideThePrivateTeam(ctx);
    ctx.prisma.issue.findMany.mockResolvedValue([SECRET_ISSUE]);
    expect(await favoriteResolvers.Favorite.entity(FAV as never, {}, ctx as never)).toBeNull();
  });

  it('resolves null for a Document of a private team', async () => {
    const ctx = makeCtx();
    outsideThePrivateTeam(ctx);
    ctx.prisma.document.findMany.mockResolvedValue([
      {
        content: 's',
        id: 'd1',
        organizationId: TEST_ORG.id,
        teamId: PRIVATE_TEAM,
        title: 'secret',
      },
    ]);
    expect(
      await favoriteResolvers.Favorite.entity(
        { entityId: 'd1', entityType: 'Document', id: 'f2' } as never,
        {},
        ctx as never,
      ),
    ).toBeNull();
  });

  it("resolves null for another user's unshared CustomView", async () => {
    const ctx = makeCtx();
    ctx.prisma.customView.findMany.mockResolvedValue([
      {
        creatorId: 'someone-else',
        filters: {},
        id: 'v1',
        name: 'secret view',
        organizationId: TEST_ORG.id,
        shared: false,
        teamId: null,
      },
    ]);
    expect(
      await favoriteResolvers.Favorite.entity(
        { entityId: 'v1', entityType: 'CustomView', id: 'f3' } as never,
        {},
        ctx as never,
      ),
    ).toBeNull();
  });

  it('resolves null for a private Team the viewer is outside of', async () => {
    const ctx = makeCtx();
    outsideThePrivateTeam(ctx);
    ctx.prisma.team.findMany.mockImplementation(async (args: { where?: { id?: unknown } }) =>
      args.where?.id
        ? [{ ...TEST_TEAM, id: PRIVATE_TEAM, organizationId: TEST_ORG.id }]
        : [{ id: PRIVATE_TEAM, memberships: [], organizationId: TEST_ORG.id }],
    );
    expect(
      await favoriteResolvers.Favorite.entity(
        { entityId: PRIVATE_TEAM, entityType: 'Team', id: 'f4' } as never,
        {},
        ctx as never,
      ),
    ).toBeNull();
  });

  it('still resolves a visible issue', async () => {
    const ctx = makeCtx();
    ctx.prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);
    const out = await favoriteResolvers.Favorite.entity(
      { entityId: TEST_ISSUE.id, entityType: 'Issue', id: 'f5' } as never,
      {},
      ctx as never,
    );
    expect(out).toMatchObject({ __typename: 'Issue', id: TEST_ISSUE.id });
  });
});

describe('customViews', () => {
  it('omits a shared view that lives in a private team the viewer is outside of', async () => {
    const ctx = makeCtx();
    ctx.prisma.team.findMany.mockResolvedValue([
      { id: PRIVATE_TEAM, memberships: [], organizationId: TEST_ORG.id },
    ]);
    ctx.prisma.customView.findMany.mockResolvedValue([
      { creatorId: 'x', id: 'v-secret', shared: true, teamId: PRIVATE_TEAM },
      { creatorId: 'x', id: 'v-open', shared: true, teamId: null },
    ]);
    const rows = (await customViewResolvers.Query.customViews(null, {}, ctx as never)) as Array<{
      id: string;
    }>;
    expect(rows.map(r => r.id)).toEqual(['v-open']);
  });

  it('rejects filters carrying unknown top-level keys at create', async () => {
    const ctx = makeCtx();
    await expect(
      customViewResolvers.Mutation.customViewCreate(
        null,
        { input: { filters: { s2: 'x' }, name: 'v' } },
        ctx as never,
      ),
    ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(ctx.prisma.customView.create).not.toHaveBeenCalled();
  });

  it('persists the cleaned filter set, not the raw input', async () => {
    const ctx = makeCtx();
    ctx.prisma.customView.create.mockResolvedValue({ id: 'v' });
    await customViewResolvers.Mutation.customViewCreate(
      null,
      {
        input: {
          filters: { conditions: [{ field: 'priority', operator: 'eq', value: 1, zzz: 1 }] },
          name: 'v',
        },
      },
      ctx as never,
    );
    const data = ctx.prisma.customView.create.mock.calls[0]?.[0].data;
    expect(data.filters).toEqual({
      composition: 'and',
      conditions: [{ field: 'priority', operator: 'eq', value: 1 }],
    });
  });
});
