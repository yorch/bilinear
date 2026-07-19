import { GraphQLError } from 'graphql';
import type { Notification } from '../../../generated/prisma';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../lib/limits';
import { clampLimit } from '../../lib/pagination';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

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
        const notification = await ctx.services.notification.markRead(id, ctx.userId);

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
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);

      await ctx.services.notification.subscribe(ctx.userId, issueId);

      // Subscriptions are user-local; no cross-client sync action needed.
      const lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
      return { lastSyncId: lastSyncId.toString(), success: true };
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
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);

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
      return ctx.services.issue.findById(notification.issueId);
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
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);

      return ctx.services.notification.isSubscribed(ctx.userId, issueId);
    },

    notifications: async (_parent: unknown, { limit }: { limit?: number }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.notification.findByUserId(
        ctx.userId,
        ctx.orgId,
        clampLimit(limit, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT),
      );
    },
    notificationUnreadCount: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.notification.getUnreadCount(ctx.userId, ctx.orgId);
    },
  },
};
