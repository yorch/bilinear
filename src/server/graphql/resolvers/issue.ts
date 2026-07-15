import { GraphQLError } from 'graphql';
import type { Issue } from '../../../generated/prisma';
import { childLogger } from '../../lib/logger';
import {
  isTeamGuest,
  requireAuth,
  requireIssueAccessNotGuestOrOwn,
  requireTeamMember,
  requireTeamMemberNotGuest,
} from '../../middleware/auth';
import type { IssueCreateInput, IssueFilter, IssueUpdateInput } from '../../services/issue.service';
import {
  IssueBulkLimitExceededError,
  IssueInvalidReferenceError,
  IssueInvalidStateError,
  IssueNotFoundError,
  IssueService,
  IssueStateRequiredError,
  IssueValidationError,
} from '../../services/issue.service';
import type { IssueActivityCreateInput } from '../../services/issue-activity.service';
import type { GraphQLContext } from '../context';

const log = childLogger({ module: 'resolver/issue' });

// Fields tracked in the activity timeline on every issue update
const TRACKED_ACTIVITY_FIELDS = [
  'stateId',
  'assigneeId',
  'priority',
  'title',
  'estimate',
  'dueDate',
  'startDate',
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

/**
 * Maps the four issue-service "bad input" error classes to a BAD_USER_INPUT
 * GraphQLError, or returns null if `err` isn't one of them (so the caller
 * can fall through to its own NOT_FOUND / rethrow handling). Shared by
 * issueCreate/issueUpdate/issuesBulkUpdate so the three mutations can't
 * drift on which input errors get remapped — issueUpdate previously omitted
 * IssueStateRequiredError, which is really just another "no valid stateId
 * to write" input error and belongs in the same bucket as its siblings.
 */
function toIssueInputGraphQLError(err: unknown): GraphQLError | null {
  if (
    err instanceof IssueStateRequiredError ||
    err instanceof IssueInvalidStateError ||
    err instanceof IssueInvalidReferenceError ||
    err instanceof IssueValidationError
  ) {
    return new GraphQLError(err.message, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  return null;
}

export const issueResolvers = {
  Issue: {
    assignee: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      if (!issue.assigneeId) {
        return null;
      }
      return ctx.loaders.user.load(issue.assigneeId);
    },

    children: async (issue: Issue, _args: unknown, ctx: GraphQLContext) => {
      // Guest visibility: hide sub-issues on the same team unless the
      // guest created or is assigned to them. Snooze hide is applied
      // uniformly so children doesn't bypass the global snooze filter.
      const userId = ctx.userId;
      const orgId = ctx.orgId;
      const ands: Array<Record<string, unknown>> = [IssueService.snoozeHideClause()];
      if (userId && orgId && (await isTeamGuest(ctx.prisma, issue.teamId, userId, orgId))) {
        ands.push({ OR: [{ creatorId: userId }, { assigneeId: userId }] });
      }
      return ctx.prisma.issue.findMany({
        orderBy: { subIssueSortOrder: 'asc' },
        // organizationId scoping: children are looked up by parentId alone,
        // so a cross-org parentId (see IssueService.validateReferences —
        // this closes the write side; this closes the read side / any
        // pre-existing bad data) could otherwise surface another org's
        // issues here.
        where: {
          AND: ands,
          organizationId: issue.organizationId,
          parentId: issue.id,
          trashed: false,
        },
      });
    },

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
      const parent = await ctx.services.issue.findById(issue.parentId);
      // Org scoping: mirror the cycle/project field resolvers immediately
      // below/above — a cross-org parentId (bad data, or a pre-fix write)
      // must never surface another org's issue here.
      if (!parent || parent.organizationId !== ctx.orgId) {
        return null;
      }
      // Guest visibility: if the caller is a guest on the parent's team
      // and doesn't own the parent issue, return null rather than the
      // row. Same rule as the top-level `issue` query.
      const userId = ctx.userId;
      const orgId = ctx.orgId;
      if (userId && orgId && (await isTeamGuest(ctx.prisma, parent.teamId, userId, orgId))) {
        if (parent.creatorId !== userId && parent.assigneeId !== userId) {
          return null;
        }
      }
      return parent;
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

    reactions: async (issue: Issue, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.issue.listReactions(issue.id),

    startDate: (issue: Issue) =>
      issue.startDate ? issue.startDate.toISOString().split('T')[0] : null,

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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      // Record the SyncAction inside the archive transaction; publish after commit.
      let issueSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
      const issue = await ctx.services.issue.archive(id, async (tx, archived) => {
        issueSync = await ctx.services.sync.recordSyncAction(
          tx,
          ctx.orgId,
          'A',
          'Issue',
          id,
          archived,
        );
      });
      if (issueSync) {
        ctx.services.sync.publish(issueSync);
      }
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'issue.archived', issue, issue.teamId)
        .catch(err => log.error({ err }, 'webhook dispatch failed: issue.archived'));
      return { issue, lastSyncId: issueSync?.id.toString() ?? '0', success: true };
    },
    issueCreate: async (
      _parent: unknown,
      { input }: { input: IssueCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      // Guests must not author issues (write-path guest enforcement). Every
      // other issue write path uses a guest-blocking guard; issueCreate must
      // too, otherwise a guest can create issues (incl. sub-issues) on a team.
      await requireTeamMemberNotGuest(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);

      try {
        // Record the SyncAction inside the create transaction so a crash can
        // never leave a persisted issue without its replication marker.
        let issueSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
        const issue = await ctx.services.issue.create(
          ctx.orgId,
          ctx.userId,
          input,
          async (tx, created) => {
            issueSync = await ctx.services.sync.recordSyncAction(
              tx,
              ctx.orgId,
              'I',
              'Issue',
              created.id,
              created,
            );
          },
        );
        // Publish to Redis only after the transaction has committed.
        if (issueSync) {
          ctx.services.sync.publish(issueSync);
        }

        // Auto-subscribe creator and notify assignee (fire-and-forget — don't
        // block the response on notification delivery)
        void ctx.services.notification
          .autoSubscribe(ctx.userId, issue.id)
          .catch(err => log.error({ err }, 'Failed to auto-subscribe issue creator'));
        if (input.assigneeId && input.assigneeId !== ctx.userId) {
          void ctx.services.notification
            .autoSubscribe(input.assigneeId, issue.id)
            .catch(err => log.error({ err }, 'Failed to auto-subscribe issue assignee'));
          void ctx.services.notification
            .createForIssueAssignment(ctx.orgId, issue.id, input.assigneeId, ctx.userId)
            .catch(err => log.error({ err }, 'Failed to create issue assignment notification'));
        }

        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'issue.created', issue, issue.teamId)
          .catch(err => log.error({ err }, 'webhook dispatch failed: issue.created'));
        void ctx.services.automation
          .evaluateForIssue(ctx.orgId, { issue, type: 'issue_created' }, ctx.userId)
          .catch(err => log.error({ err }, 'automation evaluate failed: issue_created'));
        return { issue, lastSyncId: issueSync?.id.toString() ?? '0', success: true };
      } catch (err) {
        const mapped = toIssueInputGraphQLError(err);
        if (mapped) {
          throw mapped;
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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      // Record the 'D' SyncAction inside the delete transaction; publish after.
      let issueSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
      await ctx.services.issue.delete(id, async tx => {
        issueSync = await ctx.services.sync.recordSyncAction(tx, ctx.orgId, 'D', 'Issue', id, null);
      });
      if (issueSync) {
        ctx.services.sync.publish(issueSync);
      }
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'issue.deleted', { id, teamId: existing.teamId }, existing.teamId)
        .catch(err => log.error({ err }, 'webhook dispatch failed: issue.deleted'));
      // Fire-and-forget audit log — errors are non-fatal
      ctx.services.auditLog
        .log({
          action: 'issue.deleted',
          ipAddress: ctx.clientIp,
          orgId: ctx.orgId,
          resourceId: id,
          resourceType: 'Issue',
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));
      return { lastSyncId: issueSync?.id.toString() ?? '0', success: true };
    },

    issueReactionAdd: async (
      _parent: unknown,
      { issueId, emoji }: { issueId: string; emoji: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(issueId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      let reactionSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
      const reaction = await ctx.services.issue.addReaction(
        issueId,
        ctx.userId,
        emoji,
        async (tx, created) => {
          reactionSync = await ctx.services.sync.recordSyncAction(
            tx,
            ctx.orgId,
            'I',
            'IssueReaction',
            created.id,
            created,
          );
        },
      );
      if (reactionSync) {
        ctx.services.sync.publish(reactionSync);
      }
      return { lastSyncId: reactionSync?.id.toString() ?? '0', reaction, success: true };
    },

    issueReactionRemove: async (
      _parent: unknown,
      { issueId, emoji }: { issueId: string; emoji: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(issueId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      try {
        let reactionSync:
          | Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>>
          | undefined;
        await ctx.services.issue.removeReaction(issueId, ctx.userId, emoji, async (tx, removed) => {
          reactionSync = await ctx.services.sync.recordSyncAction(
            tx,
            ctx.orgId,
            'D',
            'IssueReaction',
            removed.id,
            null,
          );
        });
        if (reactionSync) {
          ctx.services.sync.publish(reactionSync);
        }
        return { lastSyncId: reactionSync?.id.toString() ?? '0', success: true };
      } catch (err) {
        if ((err as Error).name === 'IssueReactionNotFoundError') {
          throw new GraphQLError('Reaction not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }
    },

    issueSnooze: async (
      _parent: unknown,
      { id, until }: { id: string; until: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const parsed = new Date(until);
      if (Number.isNaN(parsed.getTime())) {
        throw new GraphQLError('until must be a valid ISO timestamp', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (parsed.getTime() <= Date.now()) {
        throw new GraphQLError('Snooze deadline must be in the future', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      let issueSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
      const issue = await ctx.services.issue.snooze(id, ctx.userId, parsed, async (tx, snoozed) => {
        issueSync = await ctx.services.sync.recordSyncAction(
          tx,
          ctx.orgId,
          'U',
          'Issue',
          id,
          snoozed,
        );
      });
      if (issueSync) {
        ctx.services.sync.publish(issueSync);
      }
      return { issue, lastSyncId: issueSync?.id.toString() ?? '0', success: true };
    },

    issuesBulkUpdate: async (
      _parent: unknown,
      { ids, input }: { ids: string[]; input: IssueUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      if (ids.length === 0) {
        return {
          issues: [],
          lastSyncId: await ctx.services.sync.getLastSyncId(ctx.orgId),
          success: true,
        };
      }

      // Pre-flight: every issue must belong to this org, and the caller
      // must be a member of every distinct team. One findMany + a Set walk
      // is cheaper than re-checking on each id.
      const issues = await ctx.services.issue.findByIdsInOrg(ids, ctx.orgId);
      if (issues.length !== ids.length) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      // Per-issue access check: every team is verified AND a guest is
      // gated to issues they created or are assigned to. Done in-memory
      // off two preloads (one membership query, one role query) instead
      // of per-row — the naive form was 2 × N DB round-trips, which on
      // a 200-issue batch becomes 400 sequential queries on the request
      // path.
      const teamIds = Array.from(new Set(issues.map(i => i.teamId)));
      const [memberships, roleRows] = await Promise.all([
        ctx.prisma.teamMembership.findMany({
          select: { team: { select: { organizationId: true } }, teamId: true },
          where: { teamId: { in: teamIds }, userId: ctx.userId },
        }),
        ctx.prisma.teamMemberRole.findMany({
          select: { role: true, teamId: true },
          where: { teamId: { in: teamIds }, userId: ctx.userId },
        }),
      ]);
      const memberTeamIds = new Set(
        memberships.filter(m => m.team.organizationId === ctx.orgId).map(m => m.teamId),
      );
      const guestTeamIds = new Set(roleRows.filter(r => r.role === 'guest').map(r => r.teamId));
      for (const issue of issues) {
        if (!memberTeamIds.has(issue.teamId)) {
          throw new GraphQLError('Not a member of this team', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        if (
          guestTeamIds.has(issue.teamId) &&
          issue.creatorId !== ctx.userId &&
          issue.assigneeId !== ctx.userId
        ) {
          throw new GraphQLError('Guests can only modify issues they created or are assigned to', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
      }

      // Record one SyncAction per row INSIDE the bulk transaction so the
      // markers can't survive a rollback of the batch; publish after commit.
      type RecordedSync = Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>>;
      const recordedSyncs: RecordedSync[] = [];
      let updated: Issue[];
      try {
        updated = await ctx.services.issue.bulkUpdate(ctx.orgId, ids, input, async (tx, rows) => {
          for (const row of rows) {
            recordedSyncs.push(
              await ctx.services.sync.recordSyncAction(tx, ctx.orgId, 'U', 'Issue', row.id, row),
            );
          }
        });
      } catch (err) {
        if (err instanceof IssueBulkLimitExceededError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        const mapped = toIssueInputGraphQLError(err);
        if (mapped) {
          throw mapped;
        }
        if (err instanceof IssueNotFoundError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }

      // Publish the recorded SyncActions (already committed) and fan out
      // webhooks. Order preserved from the batch so subscribers see each
      // change in input order.
      let lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
      for (const sync of recordedSyncs) {
        ctx.services.sync.publish(sync);
        lastSyncId = sync.id.toString();
      }
      for (const issue of updated) {
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'issue.updated', issue, issue.teamId)
          .catch(err => log.error({ err }, 'webhook dispatch failed: issue.updated (bulk)'));
      }

      // Fire-and-forget audit log — errors are non-fatal
      ctx.services.auditLog
        .log({
          action: 'issue.bulk_updated',
          ipAddress: ctx.clientIp,
          metadata: { count: updated.length, ids },
          orgId: ctx.orgId,
          userId: ctx.userId,
        })
        .catch(err => log.warn({ err }, 'audit log failed'));

      return { issues: updated, lastSyncId, success: true };
    },

    issueUnarchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      let issueSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
      const issue = await ctx.services.issue.unarchive(id, async (tx, unarchived) => {
        issueSync = await ctx.services.sync.recordSyncAction(
          tx,
          ctx.orgId,
          'U',
          'Issue',
          id,
          unarchived,
        );
      });
      if (issueSync) {
        ctx.services.sync.publish(issueSync);
      }
      return { issue, lastSyncId: issueSync?.id.toString() ?? '0', success: true };
    },

    issueUnsnooze: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const existing = await ctx.services.issue.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      let issueSync: Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>> | undefined;
      const issue = await ctx.services.issue.unsnooze(id, async (tx, unsnoozed) => {
        issueSync = await ctx.services.sync.recordSyncAction(
          tx,
          ctx.orgId,
          'U',
          'Issue',
          id,
          unsnoozed,
        );
      });
      if (issueSync) {
        ctx.services.sync.publish(issueSync);
      }
      return { issue, lastSyncId: issueSync?.id.toString() ?? '0', success: true };
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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, existing, ctx.userId, ctx.orgId);

      // Snapshot old label set before mutation for diff
      const oldLabels = input.labelIds !== undefined ? await ctx.services.issue.getLabels(id) : [];

      // Record SyncActions for the issue and any cascaded rows INSIDE the
      // update transaction (atomic with the writes). Published to Redis only
      // after commit, below.
      type RecordedSync = Awaited<ReturnType<typeof ctx.services.sync.recordSyncAction>>;
      let issueSync: RecordedSync | undefined;
      const cascadedSyncs: RecordedSync[] = [];
      let updateResult: Awaited<ReturnType<typeof ctx.services.issue.update>>;
      try {
        updateResult = await ctx.services.issue.update(id, input, async (tx, res) => {
          issueSync = await ctx.services.sync.recordSyncAction(
            tx,
            ctx.orgId,
            'U',
            'Issue',
            id,
            res.issue,
          );
          for (const row of res.cascaded) {
            cascadedSyncs.push(
              await ctx.services.sync.recordSyncAction(tx, ctx.orgId, 'U', 'Issue', row.id, row),
            );
          }
        });
      } catch (err) {
        const mapped = toIssueInputGraphQLError(err);
        if (mapped) {
          throw mapped;
        }
        if (err instanceof IssueNotFoundError) {
          throw new GraphQLError(err.message, {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }
      const { issue, cascaded } = updateResult;
      if (issueSync) {
        ctx.services.sync.publish(issueSync);
      }
      for (const s of cascadedSyncs) {
        ctx.services.sync.publish(s);
      }

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

      // Label add/remove activity entries — diff against the actual persisted
      // set (not raw input) so enforceSingleSelectPerGroup drops are not logged.
      if (input.labelIds !== undefined) {
        const newLabels = await ctx.services.issue.getLabels(id);
        const oldLabelIds = new Set(oldLabels.map(l => l.id));
        const newLabelIds = new Set(newLabels.map(l => l.id));
        for (const l of oldLabels) {
          if (!newLabelIds.has(l.id)) {
            activities.push({
              actorId: ctx.userId,
              field: 'labelRemoved',
              issueId: id,
              oldValue: l.id,
            });
          }
        }
        for (const l of newLabels) {
          if (!oldLabelIds.has(l.id)) {
            activities.push({
              actorId: ctx.userId,
              field: 'labelAdded',
              issueId: id,
              newValue: l.id,
            });
          }
        }
      }

      if (activities.length > 0) {
        await ctx.services.issueActivity.createMany(activities);
      }

      // Auto-subscribe the actor so they receive future notifications on issues
      // they interact with (consistent with Linear's subscription behaviour).
      void ctx.services.notification
        .autoSubscribe(ctx.userId, issue.id)
        .catch(err => log.error({ err }, 'Failed to auto-subscribe issue actor'));

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
            .catch(err => log.error({ err }, 'Failed to auto-subscribe issue assignee'));
          void ctx.services.notification
            .createForIssueAssignment(ctx.orgId, issue.id, input.assigneeId, ctx.userId)
            .catch(err => log.error({ err }, 'Failed to create issue assignment notification'));
        }
      }

      // Notifications: status change — oldStatus/newStatus are workflow-state UUIDs;
      // human-readable names are resolved in the notification UI via the state store.
      if ('stateId' in input && input.stateId && input.stateId !== existing.stateId) {
        void ctx.services.notification
          .createForStatusChange(ctx.orgId, issue.id, ctx.userId, existing.stateId, input.stateId)
          .catch(err => log.error({ err }, 'Failed to create status change notification'));
      }

      // The issue + cascaded SyncActions were recorded inside the update
      // transaction and published above. Cascaded rows (auto-closed
      // parent/child) still need webhook + automation side effects so remote
      // clients see the cascaded state changes and an `issue_state_changed`
      // rule fires for the parent that was auto-closed exactly as it would
      // for a user-initiated close; otherwise rules see only the leaf change
      // and the parent transition silently bypasses them.
      for (const row of cascaded) {
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'issue.updated', row, row.teamId)
          .catch(err => log.error({ err }, 'webhook dispatch failed: issue.updated (cascade)'));
        void ctx.services.automation
          .evaluateForIssue(
            ctx.orgId,
            {
              changes: { stateId: { newValue: row.stateId, oldValue: existing.stateId } },
              issue: row,
              type: 'issue_state_changed',
            },
            ctx.userId,
          )
          .catch(err => log.error({ err }, 'automation evaluate failed (cascade)'));
      }

      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'issue.updated', issue, issue.teamId)
        .catch(err => log.error({ err }, 'webhook dispatch failed: issue.updated'));

      // Automation triggers — fire one per kind of change. The service
      // de-dupes by trigger_type so a single field change can only match
      // one rule shape (e.g. assignee change doesn't re-fire state rules).
      const fireAutomation = (
        type: 'issue_state_changed' | 'issue_priority_changed' | 'issue_assignee_changed',
        changes: Record<string, { newValue: unknown; oldValue: unknown }>,
      ) => {
        void ctx.services.automation
          .evaluateForIssue(ctx.orgId, { changes, issue, type }, ctx.userId)
          .catch(err => log.error({ err, type }, 'automation evaluate failed'));
      };
      if (input.stateId && input.stateId !== existing.stateId) {
        fireAutomation('issue_state_changed', {
          stateId: { newValue: input.stateId, oldValue: existing.stateId },
        });
      }
      if (input.priority !== undefined && input.priority !== existing.priority) {
        fireAutomation('issue_priority_changed', {
          priority: { newValue: input.priority, oldValue: existing.priority },
        });
      }
      // Mirror the notification guard above: `undefined` slips past
      // `'assigneeId' in input` when a partial input keeps the key but
      // strips the value, which would fire an automation with a garbage
      // newValue while the notification path stayed silent.
      if (
        'assigneeId' in input &&
        input.assigneeId !== undefined &&
        input.assigneeId !== existing.assigneeId
      ) {
        fireAutomation('issue_assignee_changed', {
          assigneeId: { newValue: input.assigneeId, oldValue: existing.assigneeId },
        });
      }

      return { issue, lastSyncId: issueSync?.id.toString() ?? '0', success: true };
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
      // Guest visibility: fetching by id must apply the same "own work
      // only" restriction as the top-level `issues` query and every other
      // per-issue mutation — a plain requireTeamMember let a guest read
      // any issue on their team by id.
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);
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

      // Guest visibility: a guest sees only issues they created or are
      // assigned to. Member/admin/owner roles see everything. Applied as
      // a filter override so we still benefit from the team's other
      // narrowing (state, priority, etc).
      const guest = await isTeamGuest(ctx.prisma, filter.teamId, ctx.userId, ctx.orgId);
      const effectiveFilter: IssueFilter & { guestUserId?: string } = guest
        ? { ...filter, guestUserId: ctx.userId }
        : filter;

      const page = await ctx.services.issue.findMany(
        ctx.orgId,
        effectiveFilter,
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
