import { describe, expect, it } from 'vitest';
import { TEST_ISSUE, TEST_ORG, TEST_USER } from '../../../test/fixtures';
import { createMockContext } from '../../../test/context-mock';
import { searchResolvers } from './search';

describe('searchResolvers', () => {
  describe('Query.searchIssues', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      const ctx = createMockContext({ orgId: null, userId: null });

      await expect(
        searchResolvers.Query.searchIssues(
          null,
          { query: 'bug' },
          ctx as never,
        ),
      ).rejects.toMatchObject({ extensions: { code: 'UNAUTHENTICATED' } });
    });

    it('returns IssueConnection with matching issues', async () => {
      const ctx = createMockContext();
      ctx.prisma.$queryRaw.mockResolvedValue([{ id: TEST_ISSUE.id }]);
      ctx.prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);

      const result = await searchResolvers.Query.searchIssues(
        null,
        { query: 'test issue', first: 10 },
        ctx as never,
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].id).toBe(TEST_ISSUE.id);
      expect(result.totalCount).toBe(1);
      expect(result.pageInfo.hasNextPage).toBe(false);
    });

    it('returns empty connection for no matches', async () => {
      const ctx = createMockContext();
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
      const ctx = createMockContext();
      ctx.prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);

      await searchResolvers.Query.searchIssues(
        null,
        { query: 'ENG-1', includeArchived: true },
        ctx as never,
      );

      // Identifier lookup — no archivedAt filter
      expect(ctx.prisma.issue.findFirst).toHaveBeenCalledWith({
        where: {
          identifier: 'ENG-1',
          organizationId: TEST_ORG.id,
        },
      });
    });
  });
});
