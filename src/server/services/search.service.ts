import type { Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';

// Pattern that matches issue identifiers like "ENG-123" (case-insensitive)
const IDENTIFIER_RE = /^[A-Z]+-\d+$/i;

export class SearchService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Search issues by ID pattern or full-text content.
   *
   * Strategy:
   * 1. If query looks like an identifier (ENG-123), do exact identifier lookup.
   * 2. Otherwise, run a PostgreSQL full-text search using the GIN index on
   *    `to_tsvector('english', title || ' ' || COALESCE(description, ''))`.
   *    Raw query returns ranked IDs; a subsequent findMany returns typed Issue rows.
   */
  async searchIssues(
    orgId: string,
    query: string,
    first = 20,
    includeArchived = false,
  ): Promise<Issue[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    // Guard against excessively long queries before hitting Postgres
    if (trimmed.length > 500) {
      return [];
    }

    // 1. Identifier lookup (instant — hits the identifier index)
    if (IDENTIFIER_RE.test(trimmed)) {
      const issue = await this.prisma.issue.findFirst({
        where: {
          identifier: trimmed.toUpperCase(),
          organizationId: orgId,
          ...(includeArchived ? {} : { archivedAt: null, trashed: false }),
        },
      });
      return issue ? [issue] : [];
    }

    // 2. Full-text search — fetch ranked IDs from Postgres, then hydrate via findMany.
    //    `plainto_tsquery` sanitises the input by stripping special characters and
    //    operators, so free-text queries are safe from SQL injection. All other values
    //    (orgId, first) are Prisma-parameterised via the Prisma.sql template tag.
    const archiveFilter = includeArchived
      ? Prisma.sql``
      : Prisma.sql`AND archived_at IS NULL AND trashed = false`;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id
        FROM issues
        WHERE organization_id = ${orgId}::uuid
          ${archiveFilter}
          AND to_tsvector('english', title || ' ' || COALESCE(description, ''))
              @@ plainto_tsquery('english', ${trimmed})
        ORDER BY ts_rank(
          to_tsvector('english', title || ' ' || COALESCE(description, '')),
          plainto_tsquery('english', ${trimmed})
        ) DESC
        LIMIT ${first}
      `,
    );

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map(r => r.id);
    const issues = await this.prisma.issue.findMany({
      where: { id: { in: ids } },
    });

    // Restore FTS rank order (findMany returns unordered)
    const rankIndex = new Map(ids.map((id, i) => [id, i]));
    return issues.sort(
      (a, b) => (rankIndex.get(a.id) ?? 0) - (rankIndex.get(b.id) ?? 0),
    );
  }
}
