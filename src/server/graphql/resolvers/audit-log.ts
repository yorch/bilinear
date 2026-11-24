import { GraphQLError } from 'graphql';
import type { AuditLogEntry } from '../../../generated/prisma';
import { InvalidCursorError } from '../../lib/created-at-cursor';
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
    auditLogExport: async (
      _parent: unknown,
      { filter }: { filter?: AuditLogFilter | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        requireOrgRole(ctx, ['owner', 'admin']);
      } catch {
        throw new GraphQLError('You need admin access to export audit logs', {
          extensions: { code: 'FORBIDDEN' },
        });
      }
      const exported = await ctx.services.auditLog.exportCsv({
        action: filter?.action ?? null,
        from: filter?.from ? String(filter.from) : null,
        orgId: ctx.orgId,
        resourceType: filter?.resourceType ?? null,
        to: filter?.to ? String(filter.to) : null,
        userId: filter?.userId ?? null,
      });
      // Exporting the trail is itself a security-relevant read: record who
      // pulled it, with which filters and how many rows (never the content).
      void ctx.services.auditLog.log({
        action: 'audit_log.exported',
        ipAddress: ctx.clientIp,
        metadata: {
          filterAction: filter?.action ?? null,
          filterResourceType: filter?.resourceType ?? null,
          filterUserId: filter?.userId ?? null,
          from: filter?.from ? String(filter.from) : null,
          rows: exported.rows,
          to: filter?.to ? String(filter.to) : null,
          truncated: exported.truncated,
        },
        orgId: ctx.orgId,
        resourceType: 'AuditLog',
        userId: ctx.userId,
      });
      return exported;
    },

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

      try {
        return await ctx.services.auditLog.findByOrg({
          action: filter?.action ?? null,
          cursor: filter?.cursor ?? null,
          from: filter?.from ? String(filter.from) : null,
          limit: filter?.limit ?? undefined,
          orgId: ctx.orgId,
          resourceType: filter?.resourceType ?? null,
          to: filter?.to ? String(filter.to) : null,
          userId: filter?.userId ?? null,
        });
      } catch (err) {
        if (err instanceof InvalidCursorError) {
          throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        throw err;
      }
    },
  },
};
