import { GraphQLError } from 'graphql';
import {
  requireAuth,
  requireTeamMember,
  requireTeamOwner,
} from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const teamMembershipResolvers = {
  Mutation: {
    teamMembershipCreate: async (
      _parent: unknown,
      {
        input,
      }: {
        input: {
          isOwner?: boolean;
          role?: string;
          teamId: string;
          userId: string;
        };
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const team = await ctx.services.team.findById(input.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await requireTeamOwner(ctx.prisma, input.teamId, ctx.userId);

      try {
        const teamMembership = await ctx.services.team.addMember(
          input.teamId,
          input.userId,
          input.isOwner ?? false,
        );
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'TeamMembership',
          teamMembership.id,
          teamMembership,
        );
        return {
          lastSyncId: sync.id.toString(),
          success: true,
          teamMembership,
        };
      } catch (err) {
        const error = err as Error & { code?: string };
        if (error.code === 'P2002') {
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

      const membership = await ctx.services.team.findMembershipWithTeam(id);
      if (!membership || membership.team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Membership not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const isSelf = membership.userId === ctx.userId;
      if (!isSelf) {
        await requireTeamOwner(ctx.prisma, membership.teamId, ctx.userId);
      }

      await ctx.services.team.removeMember(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'TeamMembership',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
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

      const membership = await ctx.services.team.findMembershipWithTeam(id);
      if (!membership || membership.team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Membership not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      if (input.isOwner !== undefined) {
        await requireTeamOwner(ctx.prisma, membership.teamId, ctx.userId);
      } else {
        await requireTeamMember(ctx.prisma, membership.teamId, ctx.userId);
      }

      const teamMembership = await ctx.services.team.updateMembership(
        id,
        input,
      );
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'TeamMembership',
        id,
        teamMembership,
      );
      return { lastSyncId: sync.id.toString(), success: true, teamMembership };
    },
  },
};
