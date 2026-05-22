import { Prisma, type PrismaClient } from '../../generated/prisma';

/**
 * Cross-team workflow analytics. All queries are org-scoped and optionally
 * filtered by teamId + date range. Returns wire-friendly plain objects;
 * resolvers should not transform them further beyond GraphQL field mapping.
 *
 * Histograms are computed server-side via $queryRaw so we don't ship raw
 * issue rows to the client just to bucket them. PRD §2.24 — gap §6.1.
 */

export type AnalyticsRange = {
  /** Inclusive YYYY-MM-DD or ISO timestamp. null = no lower bound. */
  from?: Date | string | null;
  /** Exclusive YYYY-MM-DD or ISO timestamp. null = no upper bound. */
  to?: Date | string | null;
};

export interface AnalyticsFilter {
  orgId: string;
  range?: AnalyticsRange;
  teamId?: string | null;
}

export interface HistogramBucket {
  /** Exclusive upper bound, in days. */
  bucketEnd: number;
  /** Inclusive lower bound, in days. */
  bucketStart: number;
  count: number;
}

export interface ThroughputPoint {
  count: number;
  /** ISO week-start date, YYYY-MM-DD. */
  weekStart: string;
}

export interface TimeInStateRow {
  /** Average time issues spent in this state, in hours. */
  avgHours: number;
  /** Number of issues sampled — null if not estimable. */
  sampleSize: number;
  stateId: string;
}

/**
 * Days are bucketed as: [0,1), [1,2), [2,3), [3,5), [5,8), [8,13), [13,21),
 * [21,34), [34,inf). Fibonacci-ish edges so a long tail compresses
 * gracefully without losing the short-issue resolution that engineering
 * teams care about most.
 */
const HISTOGRAM_EDGES = [0, 1, 2, 3, 5, 8, 13, 21, 34] as const;

function toDateOrNull(v: Date | string | null | undefined): Date | null {
  if (!v) {
    return null;
  }
  return v instanceof Date ? v : new Date(v);
}

function bucketize(samplesDays: number[]): HistogramBucket[] {
  const buckets: HistogramBucket[] = [];
  for (let i = 0; i < HISTOGRAM_EDGES.length; i++) {
    const start = HISTOGRAM_EDGES[i];
    const end = HISTOGRAM_EDGES[i + 1] ?? Number.POSITIVE_INFINITY;
    buckets.push({ bucketEnd: end, bucketStart: start, count: 0 });
  }
  for (const days of samplesDays) {
    for (const bucket of buckets) {
      if (days >= bucket.bucketStart && days < bucket.bucketEnd) {
        bucket.count++;
        break;
      }
    }
  }
  return buckets;
}

export class AnalyticsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Lead time = completedAt - createdAt, in days. Only counts issues with
   * completedAt within the range. Open issues are excluded — lead time
   * isn't defined for them.
   */
  async leadTimeHistogram(filter: AnalyticsFilter): Promise<HistogramBucket[]> {
    const from = toDateOrNull(filter.range?.from);
    const to = toDateOrNull(filter.range?.to);
    const rows = await this.prisma.$queryRaw<Array<{ days: number }>>`
      SELECT EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400.0 AS days
      FROM issues
      WHERE organization_id = ${filter.orgId}::uuid
        AND completed_at IS NOT NULL
        AND archived_at IS NULL
        AND trashed = false
        ${filter.teamId ? Prisma.sql`AND team_id = ${filter.teamId}::uuid` : Prisma.empty}
        ${from ? Prisma.sql`AND completed_at >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND completed_at < ${to}` : Prisma.empty}
    `;
    return bucketize(rows.map(r => Number(r.days)));
  }

  /**
   * Cycle time = completedAt - startedAt, in days. Only counts issues that
   * actually transitioned through a started state (started_at IS NOT NULL).
   */
  async cycleTimeHistogram(filter: AnalyticsFilter): Promise<HistogramBucket[]> {
    const from = toDateOrNull(filter.range?.from);
    const to = toDateOrNull(filter.range?.to);
    const rows = await this.prisma.$queryRaw<Array<{ days: number }>>`
      SELECT EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400.0 AS days
      FROM issues
      WHERE organization_id = ${filter.orgId}::uuid
        AND completed_at IS NOT NULL
        AND started_at IS NOT NULL
        AND archived_at IS NULL
        AND trashed = false
        ${filter.teamId ? Prisma.sql`AND team_id = ${filter.teamId}::uuid` : Prisma.empty}
        ${from ? Prisma.sql`AND completed_at >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND completed_at < ${to}` : Prisma.empty}
    `;
    return bucketize(rows.map(r => Number(r.days)));
  }

  /**
   * Throughput per ISO week. Each row is (week_start, issues completed in
   * that week). Useful for the "are we shipping more or less?" trend chart.
   * date_trunc('week', ...) returns the Monday of the ISO week in PG.
   */
  async throughputByWeek(filter: AnalyticsFilter): Promise<ThroughputPoint[]> {
    const from = toDateOrNull(filter.range?.from);
    const to = toDateOrNull(filter.range?.to);
    const rows = await this.prisma.$queryRaw<Array<{ week_start: Date; count: bigint }>>`
      SELECT date_trunc('week', completed_at) AS week_start, COUNT(*)::bigint AS count
      FROM issues
      WHERE organization_id = ${filter.orgId}::uuid
        AND completed_at IS NOT NULL
        AND archived_at IS NULL
        AND trashed = false
        ${filter.teamId ? Prisma.sql`AND team_id = ${filter.teamId}::uuid` : Prisma.empty}
        ${from ? Prisma.sql`AND completed_at >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND completed_at < ${to}` : Prisma.empty}
      GROUP BY week_start
      ORDER BY week_start ASC
    `;
    return rows.map(r => ({
      count: Number(r.count),
      weekStart: r.week_start.toISOString().split('T')[0],
    }));
  }

  /**
   * Approximate "average time per state" without a full state-transition
   * audit log. For now we derive a coarse estimate from the available
   * lifecycle timestamps:
   *   - "started" category states: started_at → (completed_at | canceled_at | now)
   *   - "completed" category states: completed_at → now
   *
   * A full implementation needs an `issue_state_history` table written on
   * every state change (REVIEW_BACKLOG.md §6.1 reference). This MVP
   * surfaces the metric so the UI can hook it up; once history lands the
   * service swaps to the higher-fidelity computation.
   */
  async timeInStateApprox(filter: AnalyticsFilter): Promise<TimeInStateRow[]> {
    const teamFilter = filter.teamId
      ? Prisma.sql`AND i.team_id = ${filter.teamId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ state_id: string; avg_hours: number | null; sample: bigint }>
    >`
      SELECT
        i.state_id,
        AVG(
          EXTRACT(EPOCH FROM (
            COALESCE(i.completed_at, i.canceled_at, NOW()) - i.started_at
          )) / 3600.0
        ) AS avg_hours,
        COUNT(*)::bigint AS sample
      FROM issues i
      WHERE i.organization_id = ${filter.orgId}::uuid
        AND i.started_at IS NOT NULL
        AND i.archived_at IS NULL
        AND i.trashed = false
        ${teamFilter}
      GROUP BY i.state_id
      HAVING COUNT(*) > 0
    `;
    return rows.map(r => ({
      avgHours: r.avg_hours == null ? 0 : Number(r.avg_hours),
      sampleSize: Number(r.sample),
      stateId: r.state_id,
    }));
  }
}
