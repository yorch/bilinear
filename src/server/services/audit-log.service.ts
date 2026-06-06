import type { AuditLogEntry, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'audit-log' });

export type AuditAction =
  | 'api_key.created'
  | 'api_key.revoked'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'issue.archived'
  | 'issue.bulk_updated'
  | 'issue.created'
  | 'issue.deleted'
  | 'member.invited'
  | 'member.removed'
  | 'member.role_changed'
  | 'project.created'
  | 'project.deleted'
  | 'saml.configured'
  | 'saml.disabled'
  | 'saml.enabled'
  | 'scim.token_created'
  | 'scim.token_revoked'
  | 'settings.security_changed'
  | 'team.created'
  | 'team.deleted'
  | 'webhook.created'
  | 'webhook.deleted';

export interface AuditLogCreateInput {
  action: AuditAction;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
  orgId: string;
  resourceId?: string | null;
  resourceType?: string | null;
  userAgent?: string | null;
  userId?: string | null;
}

export interface AuditLogFilter {
  action?: string | null;
  cursor?: string | null;
  from?: string | null;
  limit?: number;
  orgId: string;
  resourceType?: string | null;
  to?: string | null;
  userId?: string | null;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Write-once audit trail for security-relevant org events.
 *
 * `log()` is always fire-and-forget — it never throws. Callers should
 * attach a `.catch()` to silence any async rejection, but the method
 * itself already absorbs all errors via an internal try/catch so that
 * an audit-logging failure can never break the primary operation.
 */
export class AuditLogService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Write an audit log entry. Fire-and-forget: errors are logged and
   * swallowed so they never propagate to the caller.
   */
  async log(input: AuditLogCreateInput): Promise<void> {
    try {
      await this.prisma.auditLogEntry.create({
        data: {
          action: input.action,
          ipAddress: input.ipAddress ?? null,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
          organizationId: input.orgId,
          resourceId: input.resourceId ?? null,
          resourceType: input.resourceType ?? null,
          userAgent: input.userAgent ?? null,
          userId: input.userId ?? null,
        },
      });
    } catch (err) {
      log.error({ err }, 'failed to write audit log entry');
    }
  }

  /**
   * Paginate audit log entries for an org. Cursor is a createdAt ISO
   * timestamp — entries strictly older than the cursor are returned.
   */
  async findByOrg(filter: AuditLogFilter): Promise<AuditLogPage> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const where: Prisma.AuditLogEntryWhereInput = {
      organizationId: filter.orgId,
    };

    if (filter.userId) {
      where.userId = filter.userId;
    }
    if (filter.action) {
      where.action = filter.action;
    }
    if (filter.resourceType) {
      where.resourceType = filter.resourceType;
    }
    if (filter.from || filter.to || filter.cursor) {
      where.createdAt = {};
      if (filter.from) {
        where.createdAt.gte = new Date(filter.from);
      }
      if (filter.to) {
        where.createdAt.lte = new Date(filter.to);
      }
      // Cursor-based pagination: return rows strictly before the cursor
      if (filter.cursor) {
        where.createdAt.lt = new Date(filter.cursor);
      }
    }

    // Fetch one extra row to determine hasMore
    const rows = await this.prisma.auditLogEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      where,
    });

    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && entries.length > 0
        ? (entries[entries.length - 1]?.createdAt.toISOString() ?? null)
        : null;

    return { entries, hasMore, nextCursor };
  }
}
