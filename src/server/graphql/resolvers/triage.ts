import { GraphQLError } from 'graphql';
import { logger } from '../../lib/logger';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type { IssueActivityCreateInput } from '../../services/issue-activity.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const TRIAGE_ERROR_MAP = {
  BAD_USER_INPUT: [
    'TriageNotEnabledError',
    'TriageNotInQueueError',
    'TriageMissingTargetStateError',
    'TriageDuplicateSelfError',
    'TriageCrossOrgError',
    'TriageSnoozeInvalidDateError',
    'TriageInvalidTargetStateError',
  ],
  NOT_FOUND: ['TriageIssueNotFoundError'],
} as const;

/**
 * Record IssueActivity rows for the triage transition AND fire the
 * issue.updated webhook. The activity rows mirror what `issueUpdate`
 * writes for the same fields (stateId, assigneeId, etc.) so the
 * timeline shows the same shape regardless of which mutation drove
 * the change.
 */
async function recordTriageSideEffects(
  ctx: GraphQLContext & { orgId: string; userId: string },
  before: { stateId: string; assigneeId: string | null; priority: number; cycleId: string | null },
  after: {
    id: string;
    stateId: string;
    assigneeId: string | null;
    priority: number;
    cycleId: string | null;
    teamId: string;
  },
) {
  const activities: IssueActivityCreateInput[] = [];
  const fields: Array<keyof typeof before> = ['stateId', 'assigneeId', 'priority', 'cycleId'];
  for (const field of fields) {
    const oldVal = before[field];
    const newVal = after[field];
    if (oldVal !== newVal) {
      activities.push({
        actorId: ctx.userId,
        field,
        issueId: after.id,
        newValue: newVal == null ? undefined : String(newVal),
        oldValue: oldVal == null ? undefined : String(oldVal),
      });
    }
  }
  if (activities.length > 0) {
    await ctx.services.issueActivity.createMany(activities);
  }
  void ctx.services.webhook
    .dispatchEvent(ctx.orgId, 'issue.updated', after, after.teamId)
    .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.updated'));
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
        await recordTriageSideEffects(ctx, issue, updated);
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, TRIAGE_ERROR_MAP);
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
        await recordTriageSideEffects(ctx, issue, updated);
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, TRIAGE_ERROR_MAP);
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

      // The canonical issue must also exist within the user's org and on a
      // team they're a member of — otherwise a member of team A could link
      // duplicates to a private team-B issue they shouldn't see.
      const canonical = await ctx.services.issue.findById(canonicalIssueId);
      if (!canonical || canonical.organizationId !== ctx.orgId) {
        throw new GraphQLError('Canonical issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      if (canonical.teamId !== issue.teamId) {
        await requireTeamMember(ctx.prisma, canonical.teamId, ctx.userId);
      }

      try {
        const { issue: updated, relation } = await ctx.services.triage.markDuplicate(
          issueId,
          canonicalIssueId,
        );
        // Emit the new IssueRelation row (when one was created) so other
        // clients see the duplicate link without a full bootstrap. Skip
        // when the relation already existed — re-emitting a no-op row
        // would just generate sync churn.
        if (relation) {
          await ctx.services.sync.createSyncAction(
            ctx.orgId,
            'I',
            'IssueRelation',
            relation.id,
            relation,
          );
        }
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Issue',
          issueId,
          updated,
        );
        await recordTriageSideEffects(ctx, issue, updated);
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, TRIAGE_ERROR_MAP);
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
        // Snooze leaves stateId/assignee/priority/cycle alone, so the
        // side-effects helper would no-op on activity rows. Still fire
        // the webhook so subscribers see the snooze transition.
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'issue.updated', updated, updated.teamId)
          .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.updated'));
        return { issue: updated, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        mapServiceError(err, TRIAGE_ERROR_MAP);
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
