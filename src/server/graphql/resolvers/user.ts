import crypto from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { User } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

function buildCalendarFeedUrl(token: string | null, appUrl: string): string | null {
  if (!token) {
    return null;
  }
  return `${appUrl}/api/cycles/feed/${token}.ics`;
}

export const userResolvers = {
  Mutation: {
    apiTokenCreate: async (_parent: unknown, { label }: { label: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const result = await ctx.services.auth.createApiToken(ctx.userId, label);
      return { plaintext: result.plaintext, success: true, token: result.token };
    },

    apiTokenRevoke: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await ctx.services.auth.revokeApiToken(ctx.userId, id);
      return { success: true };
    },

    userCalendarFeedTokenRotate: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const token = crypto.randomBytes(32).toString('hex');
      const user = await ctx.prisma.user.update({
        data: { calendarFeedToken: token },
        where: { id: ctx.userId },
      });
      return { success: true, user };
    },

    userUpdateNotificationPreferences: async (
      _parent: unknown,
      { emailNotificationsEnabled }: { emailNotificationsEnabled: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const user = await ctx.prisma.user.update({
        data: { emailNotificationsEnabled },
        where: { id: ctx.userId },
      });
      return { success: true, user };
    },
  },

  Query: {
    apiTokens: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.auth.listApiTokens(ctx.userId);
    },

    viewer: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const user = await ctx.services.user.findById(ctx.userId);
      if (!user) {
        throw new GraphQLError('User not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await ctx.services.user.updateLastSeen(ctx.userId, user.lastSeen);
      return user;
    },
  },

  User: {
    avatarBackgroundColor: (user: User) => user.avatarBgColor,
    calendarFeedUrl: (user: User, _args: unknown, ctx: GraphQLContext) => {
      if (user.id !== ctx.userId) {
        return null;
      }
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      return buildCalendarFeedUrl(user.calendarFeedToken ?? null, appUrl);
    },
    emailNotificationsEnabled: (user: User) => user.emailNotificationsEnabled,
    isMe: (user: User, _args: unknown, ctx: GraphQLContext) => user.id === ctx.userId,
  },
};
