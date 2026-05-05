import { GraphQLError } from 'graphql';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

/**
 * Map a triage service error to a GraphQL error. Falls through to rethrow
 * unrecognized errors so unexpected failures still surface as 500s.
 */
function mapTriageError(err: unknown): never {
  const error = err as Error;
  switch (error.name) {
    case 'TriageIssueNotFoundError':
      throw new GraphQLError(error.message, {
        extensions: { code: 'NOT_FOUND' },
      });
    case 'TriageNotEnabledError':
    case 'TriageNotInQueueError':
    case 'TriageMissingTargetStateError':
    case 'TriageDuplicateSelfError':
    case 'TriageCrossOrgError':
    case 'TriageSnoozeInvalidDateError':
    case 'TriageInvalidTargetStateError':
      throw new GraphQLError(error.message, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    default:
      throw err;
  }
}

export const triageResolvers = {
  Mutation: {
    issueTriageAccept: async (
      _parent: unknown,
      {
        issueId,
        input,
      }: {
        issueId: string;
        input: {
          assigneeId?: string | null;
          cycleId?: string | null;
          priority?: number;
          stateId: string;
        };
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);

      try {
        const updated = await ctx.services.triage.accept(issueId, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Issue',
          issueId,
          updated,
        );
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapTriageError(err);
      }
    },

    issueTriageDecline: async (
      _parent: unknown,
      { issueId }: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);

      try {
        const updated = await ctx.services.triage.decline(issueId);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Issue',
          issueId,
          updated,
        );
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapTriageError(err);
      }
    },

    issueTriageMarkDuplicate: async (
      _parent: unknown,
      { issueId, canonicalIssueId }: { issueId: string; canonicalIssueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);

      try {
        const updated = await ctx.services.triage.markDuplicate(issueId, canonicalIssueId);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Issue',
          issueId,
          updated,
        );
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapTriageError(err);
      }
    },

    issueTriageSnooze: async (
      _parent: unknown,
      { issueId, until }: { issueId: string; until: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);

      try {
        const updated = await ctx.services.triage.snooze(issueId, new Date(until), ctx.userId);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Issue',
          issueId,
          updated,
        );
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapTriageError(err);
      }
    },
  },

  Query: {
    triageQueue: async (_parent: unknown, { teamId }: { teamId: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, teamId, ctx.userId);

      const team = await ctx.services.team.findById(teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      return ctx.services.triage.getQueue(teamId);
    },

    triageQueueCount: async (
      _parent: unknown,
      { teamId }: { teamId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, teamId, ctx.userId);
      return ctx.services.triage.getQueueCount(teamId);
    },
  },
};
