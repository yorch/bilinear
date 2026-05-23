import { GraphQLError } from 'graphql';
import type { Issue } from '../../../generated/prisma';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const GITHUB_ERROR_MAP = {
  BAD_USER_INPUT: ['GitHubIntegrationAlreadyConnectedError'],
  NOT_FOUND: ['GitHubIntegrationNotFoundError'],
} as const;

async function requireOrgAdmin(
  ctx: GraphQLContext,
): Promise<GraphQLContext & { orgId: string; userId: string }> {
  requireAuth(ctx);
  await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
  return ctx as GraphQLContext & { orgId: string; userId: string };
}

export const githubResolvers = {
  Issue: {
    pullRequests: async (issue: Issue, _args: unknown, ctx: GraphQLContext) =>
      ctx.services.github.getPullRequestsForIssue(issue.id),
  },

  Mutation: {
    githubDisconnect: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        await ctx.services.github.disconnect(auth.orgId);
        return { success: true };
      } catch (err) {
        mapServiceError(err, GITHUB_ERROR_MAP);
      }
    },

    githubRotateWebhookSecret: async (
      _parent: unknown,
      { newSecret }: { newSecret: string },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireOrgAdmin(ctx);
      if (!newSecret || newSecret.trim().length < 16) {
        throw new GraphQLError('Webhook secret must be at least 16 characters', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      try {
        const integration = await ctx.services.github.rotateWebhookSecret(
          auth.orgId,
          newSecret.trim(),
        );
        return { integration, success: true };
      } catch (err) {
        mapServiceError(err, GITHUB_ERROR_MAP);
      }
    },
  },

  Query: {
    githubIntegration: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.github.findByOrg(ctx.orgId);
    },
  },
};
