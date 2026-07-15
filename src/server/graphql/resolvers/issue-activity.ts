import { GraphQLError } from 'graphql';
import type { IssueActivity } from '../../../generated/prisma';
import { clampLimit } from '../../lib/pagination';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

// Matches the MAX-200 convention used elsewhere (auditLogs, platform-admin
// lists) — caps an uncapped client-supplied `limit` so a single query can't
// force an unbounded fetch.
const MAX_ACTIVITIES_LIMIT = 200;

export const issueActivityResolvers = {
  IssueActivity: {
    actor: async (activity: IssueActivity, _args: unknown, ctx: GraphQLContext) => {
      if (!activity.actorId) {
        return null;
      }
      return ctx.services.user.findById(activity.actorId);
    },
  },

  Query: {
    issueActivities: async (
      _parent: unknown,
      { issueId, limit }: { issueId: string; limit?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      return ctx.services.issueActivity.findByIssueId(
        issueId,
        clampLimit(limit, MAX_ACTIVITIES_LIMIT, 100),
      );
    },
  },
};
