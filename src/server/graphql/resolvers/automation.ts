import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import {
  ACTION_TYPES,
  AutomationInvalidConfigError,
  AutomationRuleNotFoundError,
  type RuleCreateInput,
  type RuleUpdateInput,
  TRIGGER_TYPES,
} from '../../services/automation.service';
import type { GraphQLContext } from '../context';

function mapError(err: unknown): never {
  if (err instanceof AutomationRuleNotFoundError) {
    throw new GraphQLError(err.message, { extensions: { code: 'NOT_FOUND' } });
  }
  if (err instanceof AutomationInvalidConfigError) {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw err as Error;
}

/**
 * AutomationRule lives only in the admin settings page, which fetches rules
 * via gql on every mount. No client store, Dexie table, or sync-manager case
 * exists for the model; emitting SyncActions would broadcast a payload every
 * connected client silently ignores. Mutations return a placeholder lastSyncId
 * — the payload contract still matches `{ success, rule, lastSyncId }`, and
 * any concurrent real SyncAction continues to advance the actual watermark.
 */
const PLACEHOLDER_LAST_SYNC_ID = '0';

export const automationResolvers = {
  Mutation: {
    automationRuleArchive: async (_p: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      try {
        const rule = await ctx.services.automation.archive(id, ctx.orgId);
        return { lastSyncId: PLACEHOLDER_LAST_SYNC_ID, rule, success: true };
      } catch (err) {
        mapError(err);
      }
    },
    automationRuleCreate: async (
      _p: unknown,
      { input }: { input: Omit<RuleCreateInput, 'organizationId'> },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      try {
        const rule = await ctx.services.automation.create({
          ...input,
          createdById: ctx.userId,
          organizationId: ctx.orgId,
        });
        return { lastSyncId: PLACEHOLDER_LAST_SYNC_ID, rule, success: true };
      } catch (err) {
        mapError(err);
      }
    },
    automationRuleUpdate: async (
      _p: unknown,
      { id, input }: { id: string; input: RuleUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      try {
        const rule = await ctx.services.automation.update(id, ctx.orgId, input);
        return { lastSyncId: PLACEHOLDER_LAST_SYNC_ID, rule, success: true };
      } catch (err) {
        mapError(err);
      }
    },
  },
  Query: {
    automationActionTypes: () => [...ACTION_TYPES],
    automationRule: async (_p: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      const rule = await ctx.services.automation.findById(id, ctx.orgId);
      if (!rule) {
        throw new GraphQLError('Automation rule not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      return rule;
    },
    automationRules: async (_p: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.automation.listByOrg(ctx.orgId);
    },
    automationTriggerTypes: () => [...TRIGGER_TYPES],
  },
};
