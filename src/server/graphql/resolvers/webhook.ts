import { GraphQLError } from 'graphql';
import type { Webhook } from '../../../generated/prisma';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import {
  WEBHOOK_EVENTS,
  type WebhookCreateInput,
  type WebhookUpdateInput,
} from '../../services/webhook.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const WEBHOOK_ERROR_MAP = {
  BAD_USER_INPUT: [
    'WebhookInvalidUrlError',
    'WebhookPrivateUrlError',
    'WebhookInvalidEventError',
    'WebhookNoEventsError',
  ],
  NOT_FOUND: ['WebhookNotFoundError'],
} as const;

/**
 * Webhook management is restricted to org owners and admins. The signing
 * secret is sensitive and the URL is fetched by the server, so we don't
 * want regular members to manage subscriptions.
 *
 * Calls requireAuth internally so callers can't accidentally skip it.
 * Returns the narrowed context so the rest of the resolver can use
 * non-null `orgId`/`userId` without type assertions.
 */
async function requireOrgAdmin(
  ctx: GraphQLContext,
): Promise<GraphQLContext & { orgId: string; userId: string }> {
  requireAuth(ctx);
  await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
  return ctx as GraphQLContext & { orgId: string; userId: string };
}

export const webhookResolvers = {
  Mutation: {
    webhookArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const webhook = await ctx.services.webhook.archive(auth.orgId, id);
        return { success: true, webhook };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookCreate: async (
      _parent: unknown,
      { input }: { input: WebhookCreateInput },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const webhook = await ctx.services.webhook.create(auth.orgId, auth.userId, input);
        return { success: true, webhook };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        await ctx.services.webhook.delete(auth.orgId, id);
        return { success: true };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookRotateSecret: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const webhook = await ctx.services.webhook.rotateSecret(auth.orgId, id);
        return { success: true, webhook };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: WebhookUpdateInput },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const webhook = await ctx.services.webhook.update(auth.orgId, id, input);
        return { success: true, webhook };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },
  },

  Query: {
    webhook: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      const webhook = await ctx.services.webhook.findById(auth.orgId, id);
      if (!webhook) {
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
      const auth = await requireOrgAdmin(ctx);
      const webhook = await ctx.services.webhook.findById(auth.orgId, webhookId);
      if (!webhook) {
        throw new GraphQLError('Webhook not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return ctx.services.webhook.listDeliveries(auth.orgId, webhookId, limit ?? 50);
    },

    // Admin-gated to match the rest of the webhook surface — the event
    // list isn't sensitive but consistency keeps role-checks predictable.
    webhookEvents: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      await requireOrgAdmin(ctx);
      return [...WEBHOOK_EVENTS];
    },

    webhooks: async (
      _parent: unknown,
      { includeArchived }: { includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      const auth = await requireOrgAdmin(ctx);
      return ctx.services.webhook.findByOrgId(auth.orgId, includeArchived ?? false);
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
