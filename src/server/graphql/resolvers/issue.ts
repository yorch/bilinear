import { GraphQLError } from 'graphql';
import type { Issue } from '../../../generated/prisma';
import { logger } from '../../lib/logger';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type { IssueCreateInput, IssueFilter, IssueUpdateInput } from '../../services/issue.service';
import type { IssueActivityCreateInput } from '../../services/issue-activity.service';
import type { GraphQLContext } from '../context';

// Fields tracked in the activity timeline on every issue update
const TRACKED_ACTIVITY_FIELDS = [
  'stateId',
  'assigneeId',
  'priority',
  'title',
  'estimate',
  'dueDate',
  'projectId',
  'trashed',
  'cycleId',
  'parentId',
] as const;

function issueFieldToString(issue: Issue, field: string): string | null {
  const v = issue[field as keyof Issue];
  if (v == null) {
    return null;
  }
  if (v instanceof Date) {
    return v.toISOString().split('T')[0];
  }
  return String(v);
}

export const issueResolvers = {
  Issue: {
    assignee: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.assigneeId) {
        return null;
      }
      return ctx.loaders.user.load(issue.assigneeId);
    },

    children: async (issue: Issue, _args: unknown, ctx: GraphQLContext) =>
      ctx.prisma.issue.findMany({
        orderBy: { subIssueSortOrder: 'asc' },
        where: { parentId: issue.id, trashed: false },
      }),

    creator: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.creatorId) {
        return null;
      }
      return ctx.loaders.user.load(issue.creatorId);
    },

    cycle: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.cycleId) {
        return null;
      }
      const cycle = await ctx.loaders.cycle.load(issue.cycleId);
      if (cycle && cycle.organizationId !== ctx.orgId) {
        return null;
      }
      return cycle;
    },

    dueDate: (issue: Issue) => (issue.dueDate ? issue.dueDate.toISOString().split('T')[0] : null),

    labels: async (issue: Issue, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.labelsByIssueId.load(issue.id),

    parent: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.parentId) {
        return null;
      }
      return ctx.services.issue.findById(issue.parentId);
    },

    project: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.projectId) {
        return null;
      }
      const project = await ctx.loaders.project.load(issue.projectId);
      if (project && project.organizationId !== ctx.orgId) {
        return null;
      }
      return project;
    },

    state: async (issue: Issue, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.workflowState.load(issue.stateId),
    team: async (issue: Issue, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.team.load(issue.teamId),
  },
  Mutation: {
    issueArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      const issue = await ctx.services.issue.archive(id);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'A', 'Issue', id, issue);
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'issue.archived', issue, issue.teamId)
        .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.archived'));
      return { issue, lastSyncId: sync.id.toString(), success: true };
    },
    issueCreate: async (
      _parent: unknown,
      { input }: { input: IssueCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);

      try {
        const issue = await ctx.services.issue.create(ctx.orgId, ctx.userId, input);

        // Auto-subscribe creator and notify assignee (fire-and-forget — don't
        // block the response on notification delivery)
        void ctx.services.notification
          .autoSubscribe(ctx.userId, issue.id)
          .catch(err => logger.error({ err }, 'Failed to auto-subscribe issue creator'));
        if (input.assigneeId && input.assigneeId !== ctx.userId) {
          void ctx.services.notification
            .autoSubscribe(input.assigneeId, issue.id)
            .catch(err => logger.error({ err }, 'Failed to auto-subscribe issue assignee'));
          void ctx.services.notification
            .createForIssueAssignment(ctx.orgId, issue.id, input.assigneeId, ctx.userId)
            .catch(err => logger.error({ err }, 'Failed to create issue assignment notification'));
        }

        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'Issue',
          issue.id,
          issue,
        );
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'issue.created', issue, issue.teamId)
          .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.created'));
        return { issue, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'IssueStateRequiredError' || error.name === 'IssueInvalidStateError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    issueDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      await ctx.services.issue.delete(id);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Issue', id, null);
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'issue.deleted', { id, teamId: existing.teamId }, existing.teamId)
        .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.deleted'));
      return { lastSyncId: sync.id.toString(), success: true };
    },

    issueUnarchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      const issue = await ctx.services.issue.unarchive(id);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Issue', id, issue);
      return { issue, lastSyncId: sync.id.toString(), success: true };
    },

    issueUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: IssueUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      const { issue, cascaded } = await ctx.services.issue.update(id, input);

      // Record an activity entry for each changed tracked field
      const activities: IssueActivityCreateInput[] = [];
      for (const field of TRACKED_ACTIVITY_FIELDS) {
        if (!(field in input) || (input as Record<string, unknown>)[field] === undefined) {
          continue;
        }
        const oldStr = issueFieldToString(existing, field);
        const newRaw = (input as Record<string, unknown>)[field];
        const newStr = newRaw != null ? String(newRaw) : null;
        if (oldStr !== newStr) {
          activities.push({
            actorId: ctx.userId,
            field,
            issueId: id,
            newValue: newStr ?? undefined,
            oldValue: oldStr ?? undefined,
          });
        }
      }
      if (activities.length > 0) {
        await ctx.services.issueActivity.createMany(activities);
      }

      // Auto-subscribe the actor so they receive future notifications on issues
      // they interact with (consistent with Linear's subscription behaviour).
      void ctx.services.notification.autoSubscribe(ctx.userId, issue.id);

      // Notifications: assignment change
      if (
        'assigneeId' in input &&
        input.assigneeId !== undefined &&
        input.assigneeId !== existing.assigneeId
      ) {
        if (input.assigneeId) {
          // Auto-subscribe new assignee and notify them
          void ctx.services.notification
            .autoSubscribe(input.assigneeId, issue.id)
            .catch(err => logger.error({ err }, 'Failed to auto-subscribe issue assignee'));
          void ctx.services.notification
            .createForIssueAssignment(ctx.orgId, issue.id, input.assigneeId, ctx.userId)
            .catch(err => logger.error({ err }, 'Failed to create issue assignment notification'));
        }
      }

      // Notifications: status change — oldStatus/newStatus are workflow-state UUIDs;
      // human-readable names are resolved in the notification UI via the state store.
      if ('stateId' in input && input.stateId && input.stateId !== existing.stateId) {
        void ctx.services.notification.createForStatusChange(
          ctx.orgId,
          issue.id,
          ctx.userId,
          existing.stateId,
          input.stateId,
        );
      }

      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Issue', id, issue);

      // Auto-close cascade may have touched parent/child issues inside the
      // same transaction. Emit one SyncAction per row so remote clients
      // see the cascaded state changes in real time (instead of next
      // bootstrap), and fire webhook events for each.
      for (const row of cascaded) {
        await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Issue', row.id, row);
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'issue.updated', row, row.teamId)
          .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.updated (cascade)'));
      }

      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'issue.updated', issue, issue.teamId)
        .catch(err => logger.error({ err }, 'webhook dispatch failed: issue.updated'));
      return { issue, lastSyncId: sync.id.toString(), success: true };
    },
  },

  Query: {
    issue: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(id);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);
      return issue;
    },

    issues: async (
      _parent: unknown,
      args: {
        filter?: IssueFilter;
        first?: number;
        after?: string;
        last?: number;
        before?: string;
        includeArchived?: boolean;
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const { filter = {}, first, after, last, before, includeArchived = false } = args;

      if (!filter.teamId) {
        throw new GraphQLError(
          'filter.teamId is required — queries must be scoped to a specific team',
          { extensions: { code: 'BAD_USER_INPUT' } },
        );
      }
      await requireTeamMember(ctx.prisma, filter.teamId, ctx.userId, ctx.orgId);

      const page = await ctx.services.issue.findMany(
        ctx.orgId,
        filter,
        { after, before, first, last },
        includeArchived,
      );

      const edges = page.nodes.map(node => ({
        cursor: node.id,
        node,
      }));

      return {
        edges,
        nodes: page.nodes,
        pageInfo: page.pageInfo,
        totalCount: page.totalCount,
      };
    },
  },
};
