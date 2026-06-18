import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole, requireTeamMember } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const slackResolvers = {
  Mutation: {
    slackDisconnect: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      await ctx.services.slack.disconnect(ctx.orgId);
      return { success: true };
    },

    slackSetDefaultTeam: async (
      _parent: unknown,
      { teamId }: { teamId: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      // Verify the chosen team belongs to this org before storing it.
      if (teamId) {
        await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
      }
      try {
        const integration = await ctx.services.slack.setDefaultTeam(ctx.orgId, teamId ?? null);
        return { integration, success: true };
      } catch {
        throw new GraphQLError('Slack is not connected', { extensions: { code: 'NOT_FOUND' } });
      }
    },
  },

  Query: {
    slackIntegration: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.slack.findByOrg(ctx.orgId);
    },
  },
};
