import { GraphQLError } from 'graphql';
import type { Webhook } from '../../../generated/prisma';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import type { WebhookCreateInput, WebhookUpdateInput } from '../../services/webhook.service';
import type { GraphQLContext } from '../context';

function mapWebhookError(err: unknown): never {
  const error = err as Error;
  switch (error.name) {
    case 'WebhookNotFoundError':
      throw new GraphQLError(error.message, {
        extensions: { code: 'NOT_FOUND' },
      });
    case 'WebhookInvalidUrlError':
    case 'WebhookPrivateUrlError':
    case 'WebhookInvalidEventError':
    case 'WebhookNoEventsError':
      throw new GraphQLError(error.message, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    default:
      throw err;
  }
}

/**
 * Webhook management is restricted to org owners and admins. The signing
 * secret is sensitive and the URL is fetched by the server, so we don't
 * want regular members to manage subscriptions.
 */
async function requireOrgAdmin(ctx: GraphQLContext & { orgId: string; userId: string }) {
  await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
}

export const webhookResolvers = {
  Mutation: {
    webhookArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      const existing = await ctx.services.webhook.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const webhook = await ctx.services.webhook.archive(id);
      return { lastSyncId: '0', success: true, webhook };
    },

    webhookCreate: async (
      _parent: unknown,
      { input }: { input: WebhookCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      try {
        const webhook = await ctx.services.webhook.create(ctx.orgId, ctx.userId, input);
        return { lastSyncId: '0', success: true, webhook };
      } catch (err) {
        mapWebhookError(err);
      }
    },

    webhookDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      const existing = await ctx.services.webhook.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.webhook.delete(id);
      return { lastSyncId: '0', success: true };
    },

    webhookRotateSecret: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      const existing = await ctx.services.webhook.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const webhook = await ctx.services.webhook.rotateSecret(id);
      return { lastSyncId: '0', success: true, webhook };
    },

    webhookUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: WebhookUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      const existing = await ctx.services.webhook.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      try {
        const webhook = await ctx.services.webhook.update(id, input);
        return { lastSyncId: '0', success: true, webhook };
      } catch (err) {
        mapWebhookError(err);
      }
    },
  },

  Query: {
    webhook: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      const webhook = await ctx.services.webhook.findById(id);
      if (!webhook || webhook.organizationId !== ctx.orgId) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return webhook;
    },

    webhookDeliveries: async (
      _parent: unknown,
      { webhookId, limit }: { webhookId: string; limit?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);

      const webhook = await ctx.services.webhook.findById(webhookId);
      if (!webhook || webhook.organizationId !== ctx.orgId) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return ctx.services.webhook.listDeliveries(webhookId, limit ?? 50);
    },

    webhookEvents: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const { WEBHOOK_EVENTS } = await import('../../services/webhook.service');
      return [...WEBHOOK_EVENTS];
    },

    webhooks: async (
      _parent: unknown,
      { includeArchived }: { includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgAdmin(ctx);
      return ctx.services.webhook.findByOrgId(ctx.orgId, includeArchived ?? false);
    },
  },
  // Defense in depth: even though every webhook entry-point requires admin,
  // we re-check on the secret field so a future resolver/loader walking
  // through a Webhook (e.g. an audit log target) can't accidentally leak
  // it to a non-admin caller. Returning null (instead of throwing) keeps
  // the parent query renderable.
  Webhook: {
    signingSecret: async (webhook: Webhook, _args: unknown, ctx: GraphQLContext) => {
      if (!ctx.userId || !ctx.orgId || webhook.organizationId !== ctx.orgId) {
        return null;
      }
      const member = await ctx.prisma.organizationMember.findUnique({
        select: { role: true },
        where: { organizationId_userId: { organizationId: ctx.orgId, userId: ctx.userId } },
      });
      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        return null;
      }
      return webhook.signingSecret;
    },
  },
};
