import { GraphQLError } from 'graphql';
import type { IssueActivity } from '../../../generated/prisma';
import { MAX_LIST_LIMIT } from '../../lib/limits';
import { clampLimit } from '../../lib/pagination';
import { requireAuth, requireIssueAccessNotGuestOrOwn } from '../../middleware/auth';
import type { GraphQLContext } from '../context';
import { getRequestVisibility } from '../request-visibility';

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

      // Org membership is not access: a private team's issue (and a guest's
      // view of someone else's) must not leak its history by id.
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);

      const activities = await ctx.services.issueActivity.findByIssueId(
        issueId,
        clampLimit(limit, MAX_LIST_LIMIT, 100),
      );

      // A team-move entry records "OLD-1 -> NEW-2" identifiers. When the issue
      // has since moved OUT of a private team, the viewer (now a reader of the
      // public destination) must not learn the private team's key.
      const vis = await getRequestVisibility(ctx);
      if (vis.hiddenTeamIds.length === 0 || !activities.some(a => a.field === 'teamId')) {
        return activities;
      }
      const hiddenKeys = new Set(
        (
          await ctx.prisma.team.findMany({
            select: { key: true },
            where: { id: { in: vis.hiddenTeamIds }, organizationId: ctx.orgId },
          })
        ).map(t => t.key),
      );
      const redact = (value: string | null) =>
        value !== null && hiddenKeys.has(value.slice(0, value.lastIndexOf('-'))) ? null : value;
      return activities.map(a =>
        a.field === 'teamId'
          ? { ...a, newValue: redact(a.newValue), oldValue: redact(a.oldValue) }
          : a,
      );
    },
  },
};
