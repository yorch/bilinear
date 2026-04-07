import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const searchResolvers = {
  Query: {
    searchIssues: async (
      _parent: unknown,
      args: { query: string; first?: number; includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const { query, first = 20, includeArchived = false } = args;

      const issues = await ctx.services.search.searchIssues(
        ctx.orgId,
        query,
        first,
        includeArchived,
      );

      const edges = issues.map(node => ({ cursor: node.id, node }));

      return {
        edges,
        nodes: issues,
        pageInfo: {
          endCursor: issues[issues.length - 1]?.id ?? null,
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: issues[0]?.id ?? null,
        },
        totalCount: issues.length,
      };
    },
  },
};
