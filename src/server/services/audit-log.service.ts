import type { AuditLogEntry, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { csvCell } from '../../lib/csv-export';
import { csvSafeText } from '../../lib/csv-safe';
import { afterCreatedAtCursor, encodeCreatedAtCursor } from '../lib/created-at-cursor';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../lib/limits';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'audit-log' });

export type AuditAction =
  | 'audit_log.exported'
  | 'api_key.created'
  | 'api_key.revoked'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'github.webhook_secret_revealed'
  | 'github.webhook_secret_rotated'
  | 'issue.archived'
  | 'issue.bulk_updated'
  | 'issue.created'
  | 'issue.deleted'
  | 'member.invite_accepted'
  | 'member.invite_revoked'
  | 'member.invited'
  | 'member.left'
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
  | 'settings.config_changed'
  | 'team.created'
  | 'team.deleted'
  | 'webhook.archived'
  | 'webhook.created'
  | 'webhook.deleted'
  | 'webhook.secret_rotated'
  | 'webhook.tested'
  | 'webhook.updated';

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

/** Hard ceiling on one CSV export so a single request cannot stream the whole table. */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
const EXPORT_BATCH = 200;

/**
 * One CSV cell. Free-text fields (metadata, user agent, names) can start with
 * `=`, `+`, `-` or `@`, which spreadsheet apps evaluate as formulas — prefix
 * those with an apostrophe so an exported log cannot execute anything.
 */
function safeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return csvCell(csvSafeText(text));
}

export interface AuditLogExport {
  csv: string;
  rows: number;
  truncated: boolean;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

/**
 * Write-once audit trail for security-relevant org events.
 *
 * `log()` is always fire-and-forget — it never throws or rejects. Errors are
 * caught and logged internally so an audit-logging failure can never break
 * the primary operation. Callers should use `void ctx.services.auditLog.log({...})`
 * and never `await` it.
 */
export class AuditLogService {
  constructor(
    private prisma: PrismaClient,
    /** Injectable so the cap and the `truncated` flag are testable without 10k rows. */
    private exportMaxRows: number = AUDIT_EXPORT_MAX_ROWS,
  ) {}

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
   * Paginate audit log entries for an org, newest first. The cursor is a
   * `(createdAt, id)` keyset (`<iso>|<uuid>`), so rows sharing a timestamp at
   * a page boundary are neither skipped nor repeated. A malformed cursor throws
   * `InvalidCursorError`.
   */
  async findByOrg(filter: AuditLogFilter): Promise<AuditLogPage> {
    const limit = Math.min(filter.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);

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
    if (filter.from || filter.to) {
      where.createdAt = {};
      if (filter.from) {
        where.createdAt.gte = new Date(filter.from);
      }
      if (filter.to) {
        where.createdAt.lte = new Date(filter.to);
      }
    }
    const after = afterCreatedAtCursor(filter.cursor);
    if (after) {
      where.AND = [after];
    }

    // Fetch one extra row to determine hasMore
    const rows = await this.prisma.auditLogEntry.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      where,
    });

    const hasMore = rows.length > limit;
    const entries = hasMore ? rows.slice(0, limit) : rows;
    const last = entries[entries.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last) : null;

    return { entries, hasMore, nextCursor };
  }

  /**
   * CSV of every entry matching the filter (cursor ignored), newest first, up
   * to AUDIT_EXPORT_MAX_ROWS. Filtering happens in the query — the export is
   * the filtered set, not whatever the client happened to load.
   */
  async exportCsv(filter: Omit<AuditLogFilter, 'cursor' | 'limit'>): Promise<AuditLogExport> {
    const entries: AuditLogEntry[] = [];
    let cursor: string | null = null;
    let truncated = false;
    while (entries.length < this.exportMaxRows) {
      const page: AuditLogPage = await this.findByOrg({ ...filter, cursor, limit: EXPORT_BATCH });
      entries.push(...page.entries);
      if (!page.hasMore || !page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
      if (entries.length >= this.exportMaxRows) {
        truncated = true;
      }
    }
    const rows = entries.slice(0, this.exportMaxRows);

    const userIds = [...new Set(rows.map(r => r.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          select: { email: true, id: true },
          where: { id: { in: userIds } },
        })
      : [];
    const emailById = new Map(users.map(u => [u.id, u.email]));

    const header = [
      'timestamp',
      'action',
      'user_id',
      'user_email',
      'resource_type',
      'resource_id',
      'ip_address',
      'metadata',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          r.createdAt.toISOString(),
          r.action,
          r.userId,
          r.userId ? emailById.get(r.userId) : null,
          r.resourceType,
          r.resourceId,
          r.ipAddress,
          r.metadata ? JSON.stringify(r.metadata) : null,
        ]
          .map(safeCsvCell)
          .join(','),
      );
    }
    return { csv: `\uFEFF${lines.join('\r\n')}`, rows: rows.length, truncated };
  }
}
