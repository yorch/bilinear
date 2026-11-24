import { GraphQLError } from 'graphql';
import type { Notification } from '../../../generated/prisma';
import { isIssueVisible } from '../../lib/entity-visibility';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../lib/limits';
import { clampLimit } from '../../lib/pagination';
import { requireAuth, requireIssueAccessNotGuestOrOwn } from '../../middleware/auth';
import type { GraphQLContext } from '../context';
import { getRequestVisibility } from '../request-visibility';

/** Shared tail of the single-row notification mutations: SyncAction + NOT_FOUND remap. */
async function runOwnedNotificationMutation(
  ctx: GraphQLContext,
  orgId: string,
  run: () => Promise<Notification>,
) {
  try {
    const notification = await run();
    const sync = await ctx.services.sync.createSyncAction(
      orgId,
      'U',
      'Notification',
      notification.id,
      notification,
    );
    return { lastSyncId: sync.id.toString(), notification, success: true };
  } catch (err) {
    if ((err as Error).name === 'NotificationNotFoundError') {
      throw new GraphQLError((err as Error).message, { extensions: { code: 'NOT_FOUND' } });
    }
    throw err;
  }
}

export const notificationResolvers = {
  Mutation: {
    notificationMarkAllRead: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);

      await ctx.services.notification.markAllRead(ctx.userId, ctx.orgId);

      // markAllRead is user-scoped and doesn't require cross-client broadcast;
      // return current org sync cursor instead of creating a spurious SyncAction.
      const lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);

      return { lastSyncId: lastSyncId.toString(), success: true };
    },

    notificationMarkRead: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      try {
        const notification = await ctx.services.notification.markRead(id, ctx.userId, ctx.orgId);

        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Notification',
          notification.id,
          notification,
        );

        return {
          lastSyncId: sync.id.toString(),
          notification,
          success: true,
        };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'NotificationNotFoundError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }
    },

    notificationMarkUnread: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return runOwnedNotificationMutation(ctx, ctx.orgId, () =>
        ctx.services.notification.markUnread(id, ctx.userId, ctx.orgId),
      );
    },

    notificationSnooze: async (
      _parent: unknown,
      { id, until }: { id: string; until: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      try {
        const notification = await ctx.services.notification.snooze(
          id,
          ctx.userId,
          new Date(until),
          ctx.orgId,
        );

        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Notification',
          notification.id,
          notification,
        );

        return {
          lastSyncId: sync.id.toString(),
          notification,
          success: true,
        };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'NotificationNotFoundError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }
    },

    notificationSubscribe: async (
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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);

      await ctx.services.notification.subscribe(ctx.userId, issueId);

      // Subscriptions are user-local; no cross-client sync action needed.
      const lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
      return { lastSyncId: lastSyncId.toString(), success: true };
    },

    notificationUnsnooze: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return runOwnedNotificationMutation(ctx, ctx.orgId, () =>
        ctx.services.notification.unsnooze(id, ctx.userId, ctx.orgId),
      );
    },

    notificationUnsubscribe: async (
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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);

      await ctx.services.notification.unsubscribe(ctx.userId, issueId);

      const lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
      return { lastSyncId: lastSyncId.toString(), success: true };
    },
  },

  Notification: {
    actor: async (notification: Notification, _args: unknown, ctx: GraphQLContext) => {
      if (!notification.actorId) {
        return null;
      }
      return ctx.services.user.findById(notification.actorId);
    },

    issue: async (notification: Notification, _args: unknown, ctx: GraphQLContext) => {
      if (!notification.issueId) {
        return null;
      }
      // A notification outlives the access that produced it (the issue may
      // have moved into a private team since), so the linked issue is gated
      // by the viewer's CURRENT visibility rather than by the row's existence.
      if (!ctx.userId || !ctx.orgId) {
        return null;
      }
      const issue = await ctx.services.issue.findById(notification.issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        return null;
      }
      const vis = await getRequestVisibility(ctx);
      return isIssueVisible(vis, issue) ? issue : null;
    },
  },

  Query: {
    notificationIsSubscribed: async (
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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);

      return ctx.services.notification.isSubscribed(ctx.userId, issueId);
    },

    notificationSubscribedIssueIds: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.notification.listSubscribedIssueIds(ctx.userId, ctx.orgId);
    },

    notifications: async (
      _parent: unknown,
      { limit, before, snoozed }: { limit?: number; before?: string; snoozed?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.notification.findByUserId(
        ctx.userId,
        ctx.orgId,
        clampLimit(limit, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT),
        { before: before ? new Date(before) : undefined, snoozed: snoozed ?? false },
      );
    },
    notificationUnreadCount: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.notification.getUnreadCount(ctx.userId, ctx.orgId);
    },
  },
};
