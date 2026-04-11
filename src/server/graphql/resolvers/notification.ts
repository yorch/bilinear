import { GraphQLError } from 'graphql';
import type { Notification } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const notificationResolvers = {
  Mutation: {
    notificationMarkAllRead: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      await ctx.services.notification.markAllRead(ctx.userId, ctx.orgId);

      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Notification',
        ctx.userId,
        null,
      );

      return { lastSyncId: sync.id.toString(), success: true };
    },

    notificationMarkRead: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      try {
        const notification = await ctx.services.notification.markRead(
          id,
          ctx.userId,
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

      await ctx.services.notification.subscribe(ctx.userId, issueId);

      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'NotificationSubscription',
        ctx.userId,
        { issueId, userId: ctx.userId },
      );

      return { lastSyncId: sync.id.toString(), success: true };
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

      await ctx.services.notification.unsubscribe(ctx.userId, issueId);

      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'NotificationSubscription',
        ctx.userId,
        { active: false, issueId, userId: ctx.userId },
      );

      return { lastSyncId: sync.id.toString(), success: true };
    },
  },

  Notification: {
    actor: async (
      notification: Notification,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      if (!notification.actorId) {
        return null;
      }
      return ctx.services.user.findById(notification.actorId);
    },

    issue: async (
      notification: Notification,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      if (!notification.issueId) {
        return null;
      }
      return ctx.services.issue.findById(notification.issueId);
    },
  },

  Query: {
    notifications: async (
      _parent: unknown,
      { limit }: { limit?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.notification.findByUserId(ctx.userId, limit ?? 50);
    },
    notificationUnreadCount: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.notification.getUnreadCount(ctx.userId, ctx.orgId);
    },
  },
};
