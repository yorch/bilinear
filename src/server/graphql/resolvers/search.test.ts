import { beforeEach, describe, expect, it } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM, TEST_USER } from '../../../test/fixtures';
import { searchResolvers } from './search';

describe('searchResolvers', () => {
  describe('Query.searchIssues', () => {
    let ctx: MockGraphQLContext;

    beforeEach(() => {
      ctx = createMockContext();
      // Default: caller is a (non-guest) member of exactly TEST_TEAM — the
      // visibility scope the resolver now always computes before searching.
      ctx.prisma.teamMembership.findMany.mockResolvedValue([
        { team: { organizationId: TEST_ORG.id }, teamId: TEST_TEAM.id },
      ]);
      ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);
    });

    it('throws UNAUTHENTICATED when not logged in', async () => {
      const unauth = createMockContext({ orgId: null, userId: null });

      await expect(
        searchResolvers.Query.searchIssues(null, { query: 'bug' }, unauth as never),
      ).rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
    });

    it('returns IssueConnection with matching issues', async () => {
      ctx.prisma.$queryRaw.mockResolvedValue([{ id: TEST_ISSUE.id }]);
      ctx.prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);

      const result = await searchResolvers.Query.searchIssues(
        null,
        { first: 10, query: 'test issue' },
        ctx as never,
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe(TEST_ISSUE.id);
      expect(result.totalCount).toBe(1);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('returns empty connection for no matches', async () => {
      ctx.prisma.$queryRaw.mockResolvedValue([]);

      const result = await searchResolvers.Query.searchIssues(
        null,
        { query: 'xyzzy not found' },
        ctx as never,
      );

      expect(result.nodes).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.pageInfo.startCursor).toBeNull();
      expect(result.pageInfo.endCursor).toBeNull();
    });

    it('passes includeArchived=true to service', async () => {
      ctx.prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);

      await searchResolvers.Query.searchIssues(
        null,
        { includeArchived: true, query: 'ENG-1' },
        ctx as never,
      );

      // Identifier lookup — no archivedAt filter, scoped to the caller's
      // member teams.
      expect(ctx.prisma.issue.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [{ teamId: { in: [TEST_TEAM.id] } }],
          identifier: 'ENG-1',
          organizationId: TEST_ORG.id,
        },
      });
    });

    it('returns no results when the caller has no visible teams', async () => {
      ctx.prisma.teamMembership.findMany.mockResolvedValue([]);

      const result = await searchResolvers.Query.searchIssues(
        null,
        { query: 'anything' },
        ctx as never,
      );

      expect(result.nodes).toHaveLength(0);
      expect(ctx.prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('scopes free-text search to guest-created/assigned issues on guest teams', async () => {
      ctx.prisma.teamMemberRole.findMany.mockResolvedValue([{ teamId: TEST_TEAM.id }]);
      ctx.prisma.$queryRaw.mockResolvedValue([{ id: TEST_ISSUE.id }]);
      ctx.prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);

      await searchResolvers.Query.searchIssues(null, { query: 'bug' }, ctx as never);

      expect(ctx.prisma.teamMemberRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ role: 'guest', userId: TEST_USER.id }),
        }),
      );
      expect(ctx.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });
});
