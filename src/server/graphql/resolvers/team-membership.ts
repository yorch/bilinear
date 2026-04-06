import { GraphQLError } from 'graphql';
import {
  requireAuth,
  requireOrgRole,
  requireTeamMember,
} from '../../middleware/auth';
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
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
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
      // Look up the membership to find its team, then verify caller is a member
      const membership = await ctx.prisma.teamMembership.findUnique({
        where: { id },
      });
      if (!membership) {
        throw new GraphQLError('Membership not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, membership.teamId, ctx.userId);

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
      // Look up the membership to find its team, then verify caller is a member
      const membership = await ctx.prisma.teamMembership.findUnique({
        where: { id },
      });
      if (!membership) {
        throw new GraphQLError('Membership not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, membership.teamId, ctx.userId);

      const teamMembership = await ctx.services.team.updateMembership(
        id,
        input,
      );
      return { lastSyncId: 0, success: true, teamMembership };
    },
  },
};
