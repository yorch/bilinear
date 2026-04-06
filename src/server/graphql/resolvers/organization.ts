import { GraphQLError } from 'graphql';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const organizationResolvers = {
  Query: {
    organization: async (
      _parent: unknown,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const org = await ctx.services.user.getOrganizationForUser(ctx.userId);
      if (!org) {
        throw new GraphQLError('Organization not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return org;
    },
  },
};
