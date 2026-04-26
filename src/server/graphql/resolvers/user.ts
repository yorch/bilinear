import { GraphQLError } from 'graphql';
import type { User } from '../../../generated/prisma';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const userResolvers = {
  Query: {
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
    isMe: (user: User, _args: unknown, ctx: GraphQLContext) => user.id === ctx.userId,
  },
};
