import { GraphQLError } from 'graphql';
import type { Team, TeamMembership } from '../../../generated/prisma';
import {
  requireAuth,
  requireOrgRole,
  requireTeamMember,
} from '../../middleware/auth';
import type {
  TeamCreateInput,
  TeamUpdateInput,
} from '../../services/team.service';
import type { GraphQLContext } from '../context';

export const teamResolvers = {
  Mutation: {
    teamCreate: async (
      _parent: unknown,
      { input }: { input: TeamCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, [
        'owner',
        'admin',
      ]);

      try {
        const team = await ctx.services.team.create(
          ctx.orgId,
          ctx.userId,
          input,
        );
        return { lastSyncId: 0, success: true, team };
      } catch (err) {
        const error = err as Error & { code?: string };
        if (error.name === 'TeamKeyInvalidError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        if (error.code === 'P2002') {
          throw new GraphQLError(
            'A team with this key already exists in the organization',
            { extensions: { code: 'BAD_USER_INPUT' } },
          );
        }
        throw err;
      }
    },

    teamDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, [
        'owner',
        'admin',
      ]);

      const team = await ctx.services.team.findById(id);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.team.delete(id);
      return { lastSyncId: 0, success: true };
    },

    teamUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: TeamUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, id, ctx.userId);

      const existing = await ctx.services.team.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const team = await ctx.services.team.update(id, input);
      return { lastSyncId: 0, success: true, team };
    },
  },

  Query: {
    team: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const team = await ctx.services.team.findById(id);
      // Scope to caller's org to prevent cross-org data leaks
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return team;
    },

    teams: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.team.findByOrgId(ctx.orgId);
    },
  },

  Team: {
    children: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.team.findChildren(team.id);
    },

    members: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.team.getMembers(team.id);
    },

    organization: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      return ctx.prisma.organization.findUnique({
        where: { id: team.organizationId },
      });
    },

    parent: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      if (!team.parentId) {
        return null;
      }
      return ctx.services.team.findById(team.parentId);
    },

    states: async (team: Team, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.workflowState.findByTeamId(team.id);
    },
  },

  TeamMembership: {
    owner: (membership: TeamMembership) => membership.isOwner,

    team: async (
      membership: TeamMembership,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      return ctx.services.team.findById(membership.teamId);
    },

    user: async (
      membership: TeamMembership,
      _args: unknown,
      ctx: GraphQLContext,
    ) => {
      return ctx.services.user.findById(membership.userId);
    },
  },
};
