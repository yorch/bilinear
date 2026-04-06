import type { User } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const userResolvers = {
  Query: {
    viewer: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const user = await ctx.services.user.findById(ctx.userId);
      if (!user) {
        throw new Error('User not found');
      }
      await ctx.services.user.updateLastSeen(ctx.userId);
      return user;
    },
  },

  User: {
    avatarBackgroundColor: (user: User) => user.avatarBgColor,
    isMe: (user: User, _args: unknown, ctx: GraphQLContext) =>
      user.id === ctx.userId,
  },
};
