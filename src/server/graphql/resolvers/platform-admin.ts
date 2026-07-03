import { GraphQLError } from 'graphql';
import { requirePlatformAdmin } from '../../middleware/auth';
import {
  ImpersonationTargetError,
  LastPlatformAdminError,
  type PlatformAuditAction,
  PlatformUserNotFoundError,
  TenantNotFoundError,
} from '../../services/platform-admin.service';
import type { GraphQLContext } from '../context';

/**
 * Resolvers for the cross-tenant platform-admin console. Authorization is
 * uniform: every field first calls `requirePlatformAdmin`, which throws
 * FORBIDDEN for non-admins and for any impersonated session.
 */

function mapPlatformError(err: unknown): never {
  if (err instanceof TenantNotFoundError || err instanceof PlatformUserNotFoundError) {
    throw new GraphQLError(err.message, { extensions: { code: 'NOT_FOUND' } });
  }
  if (err instanceof LastPlatformAdminError || err instanceof ImpersonationTargetError) {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw err;
}

/** Run a service call, remapping its typed errors to GraphQLErrors. */
async function mapped<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapPlatformError(err);
  }
}

/** Record a platform audit entry (best-effort; never blocks the mutation). */
function audit(
  ctx: GraphQLContext,
  actorId: string,
  action: PlatformAuditAction,
  targetType: string,
  targetId: string,
  metadata?: Record<string, unknown>,
): void {
  void ctx.services.platformAdmin.recordAudit({
    action,
    actorId,
    ipAddress: ctx.clientIp,
    metadata: metadata ?? null,
    targetId,
    targetType,
  });
}

export const platformAdminResolvers = {
  Mutation: {
    platformTenantDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const actorId = await requirePlatformAdmin(ctx.prisma, ctx);
      await mapped(() => ctx.services.platformAdmin.deleteTenant(id));
      audit(ctx, actorId, 'tenant.deleted', 'Organization', id);
      return ctx.services.platformAdmin.getTenant(id);
    },

    platformTenantRestore: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      const actorId = await requirePlatformAdmin(ctx.prisma, ctx);
      await mapped(() => ctx.services.platformAdmin.restoreTenant(id));
      audit(ctx, actorId, 'tenant.restored', 'Organization', id);
      return ctx.services.platformAdmin.getTenant(id);
    },

    platformTenantSuspend: async (
      _parent: unknown,
      { id, reason }: { id: string; reason?: string | null },
      ctx: GraphQLContext,
    ) => {
      const actorId = await requirePlatformAdmin(ctx.prisma, ctx);
      await mapped(() => ctx.services.platformAdmin.suspendTenant(id, reason ?? null));
      audit(ctx, actorId, 'tenant.suspended', 'Organization', id, { reason: reason ?? null });
      return ctx.services.platformAdmin.getTenant(id);
    },

    platformUserReactivate: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      const actorId = await requirePlatformAdmin(ctx.prisma, ctx);
      await mapped(() => ctx.services.platformAdmin.setUserActive(id, true));
      audit(ctx, actorId, 'user.reactivated', 'User', id);
      return ctx.services.platformAdmin.getUser(id);
    },

    platformUserSetAdmin: async (
      _parent: unknown,
      { id, isPlatformAdmin }: { id: string; isPlatformAdmin: boolean },
      ctx: GraphQLContext,
    ) => {
      const actorId = await requirePlatformAdmin(ctx.prisma, ctx);
      await mapped(() => ctx.services.platformAdmin.setPlatformAdmin(id, isPlatformAdmin));
      audit(
        ctx,
        actorId,
        isPlatformAdmin ? 'user.platform_admin_granted' : 'user.platform_admin_revoked',
        'User',
        id,
      );
      return ctx.services.platformAdmin.getUser(id);
    },

    platformUserSuspend: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const actorId = await requirePlatformAdmin(ctx.prisma, ctx);
      await mapped(() => ctx.services.platformAdmin.setUserActive(id, false));
      audit(ctx, actorId, 'user.suspended', 'User', id);
      return ctx.services.platformAdmin.getUser(id);
    },
  },

  Query: {
    impersonationState: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      if (!ctx.impersonatorId) {
        return { active: false, adminEmail: null, adminName: null };
      }
      const admin = await ctx.services.user.findById(ctx.impersonatorId);
      return {
        active: true,
        adminEmail: admin?.email ?? null,
        adminName: admin?.displayName ?? null,
      };
    },

    platformAuditLog: async (
      _parent: unknown,
      { limit, cursor }: { limit?: number | null; cursor?: string | null },
      ctx: GraphQLContext,
    ) => {
      await requirePlatformAdmin(ctx.prisma, ctx);
      return ctx.services.platformAdmin.listAuditLog({ cursor, limit });
    },

    platformMetrics: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      await requirePlatformAdmin(ctx.prisma, ctx);
      return ctx.services.platformAdmin.getMetrics();
    },

    platformTenant: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      await requirePlatformAdmin(ctx.prisma, ctx);
      return ctx.services.platformAdmin.getTenant(id);
    },

    platformTenants: async (
      _parent: unknown,
      args: { query?: string | null; includeArchived?: boolean | null; limit?: number | null },
      ctx: GraphQLContext,
    ) => {
      await requirePlatformAdmin(ctx.prisma, ctx);
      return ctx.services.platformAdmin.listTenants(args);
    },

    platformUser: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      await requirePlatformAdmin(ctx.prisma, ctx);
      return ctx.services.platformAdmin.getUser(id);
    },

    platformUsers: async (
      _parent: unknown,
      args: { query?: string | null; limit?: number | null },
      ctx: GraphQLContext,
    ) => {
      await requirePlatformAdmin(ctx.prisma, ctx);
      return ctx.services.platformAdmin.listUsers(args);
    },
  },
};
