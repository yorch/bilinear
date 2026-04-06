import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const teamMembershipResolvers = {
  Mutation: {
    teamMembershipCreate: async (
      _parent: unknown,
      {
        input,
      }: { input: { isOwner?: boolean; teamId: string; userId: string } },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, [
        'owner',
        'admin',
        'member',
      ]);

      try {
        const teamMembership = await ctx.services.team.addMember(
          input.teamId,
          input.userId,
          input.isOwner ?? false,
        );
        return { lastSyncId: 0, success: true, teamMembership };
      } catch (err) {
        const error = err as Error;
        if (error.message?.includes('Unique constraint')) {
          throw new GraphQLError('User is already a member of this team', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    teamMembershipDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await ctx.services.team.removeMember(id);
      return { lastSyncId: 0, success: true };
    },

    teamMembershipUpdate: async (
      _parent: unknown,
      {
        id,
        input,
      }: { id: string; input: { isOwner?: boolean; sortOrder?: number } },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const teamMembership = await ctx.services.team.updateMembership(
        id,
        input,
      );
      return { lastSyncId: 0, success: true, teamMembership };
    },
  },
};
