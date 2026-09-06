import { GraphQLError } from 'graphql';
import type { AuditLogEntry } from '../../../generated/prisma';
import { requireAuth, requireOrgRole } from '../../middleware/auth';
import type { AuditLogFilter } from '../../services/audit-log.service';
import type { GraphQLContext } from '../context';

export const auditLogResolvers = {
  AuditLogEntry: {
    user: async (entry: AuditLogEntry, _args: unknown, ctx: GraphQLContext) => {
      if (!entry.userId) {
        return null;
      }
      return ctx.loaders.user.load(entry.userId);
    },
  },

  Query: {
    auditLogs: async (
      _parent: unknown,
      { filter }: { filter?: AuditLogFilter | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      try {
        requireOrgRole(ctx, ['owner', 'admin']);
      } catch {
        throw new GraphQLError('You need admin access to view audit logs', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      return ctx.services.auditLog.findByOrg({
        action: filter?.action ?? null,
        cursor: filter?.cursor ?? null,
        from: filter?.from ? String(filter.from) : null,
        limit: filter?.limit ?? undefined,
        orgId: ctx.orgId,
        resourceType: filter?.resourceType ?? null,
        to: filter?.to ? String(filter.to) : null,
        userId: filter?.userId ?? null,
      });
    },
  },
};
