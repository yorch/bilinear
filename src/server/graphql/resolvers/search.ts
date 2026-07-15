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

      // Scope results to the caller's visible teams (+ guest creator/
      // assignee restriction on guest teams) — same rule as the top-level
      // `issues` query. Without this, search only filtered on org, so a
      // guest or non-member of a private team could search up full issue
      // rows from teams they can't otherwise see at all.
      const memberships = await ctx.prisma.teamMembership.findMany({
        select: { team: { select: { organizationId: true } }, teamId: true },
        where: { team: { organizationId: ctx.orgId }, userId: ctx.userId },
      });
      const memberTeamIds = memberships
        .filter(m => m.team.organizationId === ctx.orgId)
        .map(m => m.teamId);
      const roleRows = await ctx.prisma.teamMemberRole.findMany({
        select: { teamId: true },
        where: { role: 'guest', teamId: { in: memberTeamIds }, userId: ctx.userId },
      });
      const guestTeamIds = roleRows.map(r => r.teamId);

      const issues = await ctx.services.search.searchIssues(
        ctx.orgId,
        query,
        first,
        includeArchived,
        {
          guestTeamIds,
          memberTeamIds,
          userId: ctx.userId,
        },
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
