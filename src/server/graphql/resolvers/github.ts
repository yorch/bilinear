import crypto from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { Issue } from '../../../generated/prisma';
import { getIntegrationAvailability } from '../../lib/integration-availability';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import { GitHubIntegrationNotFoundError } from '../../services/github.service';
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
  requireOrgRole(ctx, ['owner', 'admin']);
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

    githubRevealWebhookSecret: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const integration = await ctx.services.github.findByOrg(auth.orgId);
        if (!integration) {
          throw new GitHubIntegrationNotFoundError();
        }
        return { success: true, webhookSecret: integration.webhookSecret };
      } catch (err) {
        mapServiceError(err, GITHUB_ERROR_MAP);
      }
    },

    githubRotateWebhookSecret: async (
      _parent: unknown,
      { newSecret }: { newSecret?: string | null },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireOrgAdmin(ctx);
      const supplied = newSecret?.trim();
      if (newSecret != null && (!supplied || supplied.length < 16)) {
        throw new GraphQLError('Webhook secret must be at least 16 characters', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      // No secret supplied: generate one server-side (CSPRNG) so it is never
      // chosen, typed or transported by the browser.
      const secret = supplied ?? crypto.randomBytes(32).toString('hex');
      try {
        const integration = await ctx.services.github.rotateWebhookSecret(auth.orgId, secret);
        return { integration, success: true, webhookSecret: supplied ? null : secret };
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
    integrationAvailability: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return getIntegrationAvailability();
    },
  },
};
