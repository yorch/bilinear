import type { Issue, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import { IDENTIFIER_RE } from '../../lib/identifiers';

/**
 * Caller visibility scope for searchIssues — mirrors the guest/team
 * scoping the top-level `issues` query applies via `IssueFilter`. Without
 * this, a full-text or identifier search only filtered on organization_id:
 * a guest or a non-member of a PRIVATE team could search up and read full
 * issue rows (title/description/assignee/etc.) from teams they otherwise
 * have no access to at all.
 *
 * - `memberTeamIds`: every team the caller belongs to in this org. Results
 *   are always restricted to these teams.
 * - `guestTeamIds`: the subset of `memberTeamIds` where the caller is a
 *   guest — on those teams only issues the caller created or is assigned
 *   to are visible (same rule as `requireIssueAccessNotGuestOrOwn`).
 */
export interface SearchVisibilityScope {
  guestTeamIds: string[];
  memberTeamIds: string[];
  userId: string;
}

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
   *
   * `visibility` is optional (rather than required) so existing internal
   * callers that intentionally search across the whole org (e.g.
   * AiService.findDuplicates, which is not reachable by an unprivileged
   * caller directly) keep working unchanged. Every user-facing GraphQL path
   * (the `searchIssues` resolver) MUST supply it.
   */
  async searchIssues(
    orgId: string,
    query: string,
    first = 20,
    includeArchived = false,
    visibility?: SearchVisibilityScope,
  ): Promise<Issue[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    // Guard against excessively long queries before hitting Postgres
    if (trimmed.length > 500) {
      return [];
    }
    // A caller with no visible teams at all can't match anything — short
    // circuit before hitting Postgres.
    if (visibility && visibility.memberTeamIds.length === 0) {
      return [];
    }

    // 1. Identifier lookup (instant — hits the identifier index)
    if (IDENTIFIER_RE.test(trimmed)) {
      const issue = await this.prisma.issue.findFirst({
        where: {
          identifier: trimmed.toUpperCase(),
          organizationId: orgId,
          ...(includeArchived ? {} : { archivedAt: null, trashed: false }),
          ...this.visibilityWhere(visibility),
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
    const teamFilter = visibility
      ? Prisma.sql`AND team_id = ANY(${visibility.memberTeamIds}::uuid[])`
      : Prisma.sql``;
    const guestFilter =
      visibility && visibility.guestTeamIds.length > 0
        ? Prisma.sql`AND (
            team_id != ALL(${visibility.guestTeamIds}::uuid[])
            OR creator_id = ${visibility.userId}::uuid
            OR assignee_id = ${visibility.userId}::uuid
          )`
        : Prisma.sql``;

    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id
        FROM issues
        WHERE organization_id = ${orgId}::uuid
          ${archiveFilter}
          ${teamFilter}
          ${guestFilter}
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
    return issues.sort((a, b) => (rankIndex.get(a.id) ?? 0) - (rankIndex.get(b.id) ?? 0));
  }

  private visibilityWhere(visibility?: SearchVisibilityScope): Record<string, unknown> {
    if (!visibility) {
      return {};
    }
    const ands: Array<Record<string, unknown>> = [{ teamId: { in: visibility.memberTeamIds } }];
    if (visibility.guestTeamIds.length > 0) {
      ands.push({
        OR: [
          { teamId: { notIn: visibility.guestTeamIds } },
          { creatorId: visibility.userId },
          { assigneeId: visibility.userId },
        ],
      });
    }
    return { AND: ands };
  }
}
