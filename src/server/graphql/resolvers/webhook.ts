import { GraphQLError } from 'graphql';
import type { Webhook } from '../../../generated/prisma';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../lib/limits';
import { childLogger } from '../../lib/logger';
import { clampLimit } from '../../lib/pagination';
import { isOrgAdmin, requireAuth, requireOrgRole } from '../../middleware/auth';
import { checkFixedWindow } from '../../middleware/rate-limit';
import type { AuditAction } from '../../services/audit-log.service';
import {
  WEBHOOK_EVENTS,
  type WebhookCreateInput,
  type WebhookUpdateInput,
} from '../../services/webhook.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const log = childLogger({ module: 'resolver/webhook' });

/**
 * A test ping makes the server open an outbound connection and wait for it, so
 * it is rate limited per webhook (a stuck endpoint cannot be hammered) and per
 * user (cycling through hooks cannot be used to fan out). Fixed 1-minute window.
 */
export const WEBHOOK_TEST_LIMIT_PER_HOOK = 5;
export const WEBHOOK_TEST_LIMIT_PER_USER = 15;
const WEBHOOK_TEST_WINDOW_SECONDS = 60;

const WEBHOOK_ERROR_MAP = {
  BAD_USER_INPUT: [
    'WebhookInvalidUrlError',
    'WebhookPrivateUrlError',
    'WebhookInvalidEventError',
    'WebhookNoEventsError',
    'WebhookInvalidNameError',
    'WebhookTestUnavailableError',
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
  requireOrgRole(ctx, ['owner', 'admin']);
  return ctx as GraphQLContext & { orgId: string; userId: string };
}

/**
 * Fire-and-forget audit entry for a webhook change. Deliberately records only
 * the name and non-sensitive facts — never the signing secret, and not the URL
 * (receiver URLs commonly embed tokens).
 */
function auditWebhook(
  ctx: GraphQLContext & { orgId: string; userId: string },
  action: AuditAction,
  webhook: { id: string; name: string },
  extra: Record<string, unknown> = {},
): void {
  ctx.services.auditLog
    .log({
      action,
      ipAddress: ctx.clientIp,
      metadata: { name: webhook.name, ...extra },
      orgId: ctx.orgId,
      resourceId: webhook.id,
      resourceType: 'Webhook',
      userId: ctx.userId,
    })
    .catch(err => log.warn({ err }, 'audit log failed'));
}

export const webhookResolvers = {
  Mutation: {
    webhookArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const webhook = await ctx.services.webhook.archive(auth.orgId, id);
        auditWebhook(auth, 'webhook.archived', webhook);
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
        auditWebhook(auth, 'webhook.created', webhook, { events: webhook.events });
        return { success: true, webhook };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const deleted = await ctx.services.webhook.delete(auth.orgId, id);
        auditWebhook(auth, 'webhook.deleted', deleted);
        return { success: true };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookRotateSecret: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      try {
        const webhook = await ctx.services.webhook.rotateSecret(auth.orgId, id);
        auditWebhook(auth, 'webhook.secret_rotated', webhook);
        return { success: true, webhook };
      } catch (err) {
        mapServiceError(err, WEBHOOK_ERROR_MAP);
      }
    },

    webhookTest: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const auth = await requireOrgAdmin(ctx);
      const [byHook, byUser] = await Promise.all([
        checkFixedWindow(
          `rl:webhook-test:hook:${id}`,
          WEBHOOK_TEST_LIMIT_PER_HOOK,
          WEBHOOK_TEST_WINDOW_SECONDS,
        ),
        checkFixedWindow(
          `rl:webhook-test:user:${auth.userId}`,
          WEBHOOK_TEST_LIMIT_PER_USER,
          WEBHOOK_TEST_WINDOW_SECONDS,
        ),
      ]);
      if (byHook.exceeded || byUser.exceeded) {
        throw new GraphQLError('Too many test events. Wait a minute and try again.', {
          extensions: { code: 'RATELIMITED' },
        });
      }
      try {
        const delivery = await ctx.services.webhook.sendTest(auth.orgId, id);
        auditWebhook(
          auth,
          'webhook.tested',
          { id, name: (await ctx.services.webhook.findById(auth.orgId, id))?.name ?? '' },
          { status: delivery.status },
        );
        return { delivery, success: delivery.status === 'success' };
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
        auditWebhook(auth, 'webhook.updated', webhook, {
          changed: Object.keys(input).filter(
            k => (input as Record<string, unknown>)[k] !== undefined,
          ),
        });
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
      return ctx.services.webhook.listDeliveries(
        auth.orgId,
        webhookId,
        clampLimit(limit, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT),
      );
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
      if (!isOrgAdmin(ctx)) {
        return null;
      }
      return webhook.signingSecret;
    },
  },
};
