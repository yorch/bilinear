import { Prisma, type PrismaClient } from '../../generated/prisma';
import { validateFilterSet } from '../../lib/filter-validate';
import { type DerivedHealthResult, deriveInitiativeHealth } from '../../lib/initiative-health';
import {
  aggregateInsights,
  INSIGHT_MEASURES,
  INSIGHT_SLICES,
  INSIGHTS_SCAN_LIMIT,
  type InsightIssue,
  type InsightMeasure,
  type InsightResult,
  type InsightSlice,
} from '../../lib/insights-aggregate';
import {
  type BurnupForecast,
  type BurnupPoint,
  buildBurnupSeries,
  forecastCompletion,
  utcDay,
} from '../../lib/project-burnup';
import { toDateOnly } from '../lib/date-only';
import { filterSetToWhere, UnsupportedFilterError } from '../lib/insights-filters';
import { buildGuestVisibilityWhere } from '../lib/issue-visibility';

/**
 * Which issues the caller may count: exactly what bootstrap/delta ship them
 * (`getSyncVisibility`). Only PRIVATE teams the caller is not in are hidden —
 * a public team's issues are visible to every org member whether or not they
 * joined it — and on guest teams only issues they created or are assigned to.
 */
export interface IssueVisibilityScope {
  guestTeamIds: string[];
  hiddenTeamIds: string[];
  userId: string;
}

export function issueVisibilityWhere(scope: IssueVisibilityScope): Prisma.IssueWhereInput {
  const ands: Prisma.IssueWhereInput[] = [];
  if (scope.hiddenTeamIds.length > 0) {
    ands.push({ teamId: { notIn: scope.hiddenTeamIds } });
  }
  if (scope.guestTeamIds.length > 0) {
    ands.push(
      buildGuestVisibilityWhere({ guestTeamIds: scope.guestTeamIds, userId: scope.userId }),
    );
  }
  return ands.length === 0 ? {} : { AND: ands };
}

export interface ProjectBurnupResult {
  forecast: BurnupForecast;
  points: BurnupPoint[];
  projectId: string;
  targetDate: string | null;
}

export interface InitiativeHealthRollup extends DerivedHealthResult {
  initiativeId: string;
  /** Newest posted initiative update's health, if any — authoritative over `health`. */
  manualHealth: string | null;
}

export class InsightsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsightsInputError';
  }
}

export { INSIGHTS_SCAN_LIMIT };
/** How long an identical Insights call is served from memory. */
export const INSIGHTS_CACHE_TTL_MS = 10_000;
const INSIGHTS_CACHE_MAX = 200;

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
  /**
   * Exclusive upper bound in days, or `null` for the final open-ended bucket.
   *
   * `null`, not `Number.POSITIVE_INFINITY`: GraphQL's `Float` serialiser
   * rejects non-finite numbers, so `Infinity` here threw during response
   * serialisation. Because the Insights page asks for four fields in one
   * document, that single unserialisable value failed the whole query and the
   * section rendered "Failed to load analytics" for every workspace, always.
   */
  bucketEnd: number | null;
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

export interface TeamHealthResult {
  oldestOpenAgeDays: number;
  openCount: number;
  overdueCount: number;
  p75AgeDays: number;
  unestimatedCount: number;
  unestimatedPct: number;
}

export interface CycleVelocityPoint {
  completedIssues: number;
  completedPoints: number;
  cycleId: string;
  cycleNumber: number;
  cycleStartsAt: string;
}

export interface CycleVelocityTrendResult {
  cycles: CycleVelocityPoint[];
  rolling3: number;
  rolling3Points: number;
  rolling6: number;
  rolling6Points: number;
  rolling12: number;
  rolling12Points: number;
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
    // `null` for the last edge, meaning unbounded — see HistogramBucket.
    const end = HISTOGRAM_EDGES[i + 1] ?? null;
    buckets.push({ bucketEnd: end, bucketStart: start, count: 0 });
  }
  for (const days of samplesDays) {
    for (const bucket of buckets) {
      if (days >= bucket.bucketStart && (bucket.bucketEnd === null || days < bucket.bucketEnd)) {
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
    const conditions: Prisma.Sql[] = [
      Prisma.sql`organization_id = ${filter.orgId}::uuid`,
      Prisma.sql`completed_at IS NOT NULL`,
      Prisma.sql`archived_at IS NULL`,
      Prisma.sql`trashed = false`,
    ];
    if (filter.teamId) {
      conditions.push(Prisma.sql`team_id = ${filter.teamId}::uuid`);
    }
    if (from) {
      conditions.push(Prisma.sql`completed_at >= ${from}`);
    }
    if (to) {
      conditions.push(Prisma.sql`completed_at < ${to}`);
    }
    const rows = await this.prisma.$queryRaw<Array<{ days: number }>>(
      Prisma.sql`SELECT EXTRACT(EPOCH FROM (completed_at - created_at)) / 86400.0 AS days FROM issues WHERE ${Prisma.join(conditions, ' AND ')}`,
    );
    return bucketize(rows.map(r => Number(r.days)));
  }

  /**
   * Cycle time = completedAt - startedAt, in days. Only counts issues that
   * actually transitioned through a started state (started_at IS NOT NULL).
   */
  async cycleTimeHistogram(filter: AnalyticsFilter): Promise<HistogramBucket[]> {
    const from = toDateOrNull(filter.range?.from);
    const to = toDateOrNull(filter.range?.to);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`organization_id = ${filter.orgId}::uuid`,
      Prisma.sql`completed_at IS NOT NULL`,
      Prisma.sql`started_at IS NOT NULL`,
      Prisma.sql`archived_at IS NULL`,
      Prisma.sql`trashed = false`,
    ];
    if (filter.teamId) {
      conditions.push(Prisma.sql`team_id = ${filter.teamId}::uuid`);
    }
    if (from) {
      conditions.push(Prisma.sql`completed_at >= ${from}`);
    }
    if (to) {
      conditions.push(Prisma.sql`completed_at < ${to}`);
    }
    const rows = await this.prisma.$queryRaw<Array<{ days: number }>>(
      Prisma.sql`SELECT EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400.0 AS days FROM issues WHERE ${Prisma.join(conditions, ' AND ')}`,
    );
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
    const conditions: Prisma.Sql[] = [
      Prisma.sql`organization_id = ${filter.orgId}::uuid`,
      Prisma.sql`completed_at IS NOT NULL`,
      Prisma.sql`archived_at IS NULL`,
      Prisma.sql`trashed = false`,
    ];
    if (filter.teamId) {
      conditions.push(Prisma.sql`team_id = ${filter.teamId}::uuid`);
    }
    if (from) {
      conditions.push(Prisma.sql`completed_at >= ${from}`);
    }
    if (to) {
      conditions.push(Prisma.sql`completed_at < ${to}`);
    }
    const rows = await this.prisma.$queryRaw<Array<{ week_start: Date; count: bigint }>>(
      Prisma.sql`SELECT date_trunc('week', completed_at) AS week_start, COUNT(*)::bigint AS count FROM issues WHERE ${Prisma.join(conditions, ' AND ')} GROUP BY week_start ORDER BY week_start ASC`,
    );
    return rows.map(r => ({
      count: Number(r.count),
      weekStart: toDateOnly(r.week_start),
    }));
  }

  /**
   * Team health snapshot: overdue issues, unestimated issues, and open-issue
   * age statistics. "Open" excludes completed, canceled, trashed, and
   * archived issues. No date-range filter — this is a point-in-time view.
   */
  async teamHealth(filter: AnalyticsFilter): Promise<TeamHealthResult> {
    const now = new Date();

    // Fetch all open issues for the team to compute age percentiles.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`i.organization_id = ${filter.orgId}::uuid`,
      Prisma.sql`i.archived_at IS NULL`,
      Prisma.sql`i.trashed = false`,
      Prisma.sql`ws.type NOT IN ('completed', 'canceled')`,
    ];
    if (filter.teamId) {
      conditions.push(Prisma.sql`i.team_id = ${filter.teamId}::uuid`);
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ age_days: number; is_overdue: boolean; estimate: number | null }>
    >(
      Prisma.sql`SELECT EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 86400.0 AS age_days, (i.due_date IS NOT NULL AND i.due_date < ${now}) AS is_overdue, i.estimate FROM issues i JOIN workflow_states ws ON ws.id = i.state_id WHERE ${Prisma.join(conditions, ' AND ')} ORDER BY age_days DESC`,
    );

    const openCount = rows.length;
    const overdueCount = rows.filter(r => r.is_overdue).length;
    const unestimatedCount = rows.filter(r => r.estimate == null).length;
    const unestimatedPct = openCount > 0 ? (unestimatedCount / openCount) * 100 : 0;

    const ageDays = rows.map(r => Number(r.age_days)).sort((a, b) => a - b);
    const oldestOpenAgeDays = ageDays.length > 0 ? (ageDays[ageDays.length - 1] ?? 0) : 0;

    let p75AgeDays = 0;
    if (ageDays.length > 0) {
      const idx = Math.floor(ageDays.length * 0.75);
      p75AgeDays = ageDays[Math.min(idx, ageDays.length - 1)] ?? 0;
    }

    return {
      oldestOpenAgeDays,
      openCount,
      overdueCount,
      p75AgeDays,
      unestimatedCount,
      unestimatedPct,
    };
  }

  /**
   * Per-cycle velocity (completed issue count + story points) for the last N
   * completed cycles in the team, plus 3/6/12-cycle rolling averages.
   * Issues are considered completed when completedAt IS NOT NULL.
   */
  async cycleVelocityTrend(
    filter: AnalyticsFilter & { cycleCount?: number },
  ): Promise<CycleVelocityTrendResult> {
    const limit = filter.cycleCount ?? 12;

    const completedCycles = await this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      take: limit,
      where: {
        archivedAt: null,
        OR: [{ completedAt: { not: null } }, { endsAt: { lte: new Date() } }],
        team: { organizationId: filter.orgId },
        ...(filter.teamId ? { teamId: filter.teamId } : {}),
      },
    });

    const cyclePoints = await Promise.all(
      completedCycles.map(async cycle => {
        const issues = await this.prisma.issue.findMany({
          select: { estimate: true },
          where: {
            archivedAt: null,
            completedAt: { not: null },
            cycleId: cycle.id,
            trashed: false,
          },
        });
        const completedIssues = issues.length;
        const completedPoints = issues.reduce((sum, i) => sum + (i.estimate ?? 0), 0);
        return {
          completedIssues,
          completedPoints,
          cycleId: cycle.id,
          cycleNumber: cycle.number,
          cycleStartsAt: cycle.startsAt.toISOString(),
        };
      }),
    );

    // Restore chronological order for display; rolling averages use the last N
    const chronological = [...cyclePoints].reverse();

    function rollingAvg(
      arr: CycleVelocityPoint[],
      n: number,
      field: keyof CycleVelocityPoint,
    ): number {
      const slice = arr.slice(-n);
      if (slice.length === 0) {
        return 0;
      }
      return slice.reduce((s, c) => s + (c[field] as number), 0) / slice.length;
    }

    return {
      cycles: chronological,
      rolling3: rollingAvg(chronological, 3, 'completedIssues'),
      rolling3Points: rollingAvg(chronological, 3, 'completedPoints'),
      rolling6: rollingAvg(chronological, 6, 'completedIssues'),
      rolling6Points: rollingAvg(chronological, 6, 'completedPoints'),
      rolling12: rollingAvg(chronological, 12, 'completedIssues'),
      rolling12Points: rollingAvg(chronological, 12, 'completedPoints'),
    };
  }

  /**
   * Scope creep + carryover metrics for a single cycle.
   *
   * - scopeCreepCount: issues genuinely added mid-sprint (addedToCycleAt after
   *   cycle.startsAt — issues planned into an upcoming cycle are also stamped, but
   *   before it starts, so they are not creep — excluding carried-over issues). Carryover issues are also added after start via
   *   rollover and are subtracted out.
   * - carryoverCount: exact count from Cycle.carryoverCount stamped during
   *   rollover. Accurate for cycles run through the new code; 0 for legacy.
   * - plannedCount: issues that were in scope at cycle start (not added after cycle start)
   * - totalCount: total issues assigned to the cycle
   * - completedCount: issues completed during the cycle
   */
  async cycleScopeAndCarryover(cycleId: string): Promise<{
    carryoverCount: number;
    carryoverPct: number;
    completedCount: number;
    plannedCount: number;
    scopeCreepCount: number;
    scopeCreepPct: number;
    totalCount: number;
  }> {
    const cycle = await this.prisma.cycle.findUnique({
      select: { carryoverCount: true, startsAt: true },
      where: { id: cycleId },
    });

    const [total, scopeCreep, completed] = await Promise.all([
      this.prisma.issue.count({
        where: { archivedAt: null, cycleId, trashed: false },
      }),
      this.prisma.issue.count({
        where: {
          // Without a cycle row there is no start to compare against: nothing is creep.
          addedToCycleAt: cycle ? { gt: cycle.startsAt } : { not: null },
          archivedAt: null,
          cycleId,
          trashed: false,
        },
      }),
      this.prisma.issue.count({
        where: { archivedAt: null, completedAt: { not: null }, cycleId, trashed: false },
      }),
    ]);

    const carryoverCount = cycle?.carryoverCount ?? 0;
    // Subtract carried-over issues: they also have addedToCycleAt set but are
    // not genuine scope creep.
    const trueScopeCreepCount = Math.max(0, scopeCreep - carryoverCount);
    const planned = total - scopeCreep;

    return {
      carryoverCount,
      carryoverPct: total > 0 ? (carryoverCount / total) * 100 : 0,
      completedCount: completed,
      plannedCount: planned,
      scopeCreepCount: trueScopeCreepCount,
      scopeCreepPct: total > 0 ? (trueScopeCreepCount / total) * 100 : 0,
      totalCount: total,
    };
  }

  /**
   * Workspace-level aggregate metrics across all teams.
   * Returns per-team stats for the cross-team analytics dashboard.
   */
  async workspaceOverview(orgId: string): Promise<{
    teams: Array<{
      avgCycleTimeDays: number;
      completedCount: number;
      completionRate: number;
      openCount: number;
      teamId: string;
      teamName: string;
      totalCount: number;
    }>;
    totalCompleted: number;
    totalOpen: number;
    totalIssues: number;
  }> {
    const teams = await this.prisma.team.findMany({
      select: { id: true, name: true },
      where: { archivedAt: null, organizationId: orgId },
    });

    const teamStats = await Promise.all(
      teams.map(async team => {
        const [total, open, completed] = await Promise.all([
          this.prisma.issue.count({
            where: { archivedAt: null, teamId: team.id, trashed: false },
          }),
          this.prisma.issue.count({
            where: {
              archivedAt: null,
              completedAt: null,
              state: { type: { notIn: ['completed', 'canceled'] } },
              teamId: team.id,
              trashed: false,
            },
          }),
          this.prisma.issue.count({
            where: {
              archivedAt: null,
              completedAt: { not: null },
              teamId: team.id,
              trashed: false,
            },
          }),
        ]);

        const cycleTimeRows = await this.prisma.$queryRaw<Array<{ avg_days: number | null }>>`
          SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 86400.0) AS avg_days
          FROM issues
          WHERE team_id = ${team.id}::uuid
            AND completed_at IS NOT NULL
            AND started_at IS NOT NULL
            AND archived_at IS NULL
            AND trashed = false
        `;

        return {
          avgCycleTimeDays: Number(cycleTimeRows[0]?.avg_days ?? 0),
          completedCount: completed,
          completionRate: total > 0 ? (completed / total) * 100 : 0,
          openCount: open,
          teamId: team.id,
          teamName: team.name,
          totalCount: total,
        };
      }),
    );

    const totalCompleted = teamStats.reduce((s, t) => s + t.completedCount, 0);
    const totalOpen = teamStats.reduce((s, t) => s + t.openCount, 0);
    const totalIssues = teamStats.reduce((s, t) => s + t.totalCount, 0);

    return {
      teams: teamStats.sort((a, b) => b.completedCount - a.completedCount),
      totalCompleted,
      totalIssues,
      totalOpen,
    };
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
    const conditions: Prisma.Sql[] = [
      Prisma.sql`i.organization_id = ${filter.orgId}::uuid`,
      Prisma.sql`i.started_at IS NOT NULL`,
      Prisma.sql`i.archived_at IS NULL`,
      Prisma.sql`i.trashed = false`,
    ];
    if (filter.teamId) {
      conditions.push(Prisma.sql`i.team_id = ${filter.teamId}::uuid`);
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ state_id: string; avg_hours: number | null; sample: bigint }>
    >(
      Prisma.sql`SELECT i.state_id, AVG(EXTRACT(EPOCH FROM (COALESCE(i.completed_at, i.canceled_at, NOW()) - i.started_at)) / 3600.0) AS avg_hours, COUNT(*)::bigint AS sample FROM issues i WHERE ${Prisma.join(conditions, ' AND ')} GROUP BY i.state_id HAVING COUNT(*) > 0`,
    );
    return rows.map(r => ({
      avgHours: r.avg_hours == null ? 0 : Number(r.avg_hours),
      sampleSize: Number(r.sample),
      stateId: r.state_id,
    }));
  }

  /**
   * Burn-up for one project, over only the issues `scope` may see. Returns
   * null when the project is not in the org.
   */
  async projectBurnup(
    orgId: string,
    projectId: string,
    scope: IssueVisibilityScope,
    now: Date = new Date(),
  ): Promise<ProjectBurnupResult | null> {
    const project = await this.prisma.project.findFirst({
      select: { id: true, targetDate: true },
      where: { archivedAt: null, id: projectId, organizationId: orgId },
    });
    if (!project) {
      return null;
    }
    const forecasts = await this.projectBurnups(orgId, [project], scope, now);
    return forecasts.get(project.id) as ProjectBurnupResult;
  }

  /** Shared by the single-project query and the initiative roll-up. */
  private async projectBurnups(
    orgId: string,
    projects: Array<{ id: string; targetDate: Date | null }>,
    scope: IssueVisibilityScope,
    now: Date,
  ): Promise<Map<string, ProjectBurnupResult>> {
    const out = new Map<string, ProjectBurnupResult>();
    const issues =
      projects.length === 0
        ? []
        : await this.prisma.issue.findMany({
            select: {
              addedToProjectAt: true,
              canceledAt: true,
              completedAt: true,
              createdAt: true,
              projectId: true,
            },
            where: {
              ...issueVisibilityWhere(scope),
              archivedAt: null,
              organizationId: orgId,
              projectId: { in: projects.map(p => p.id) },
              trashed: false,
            },
          });
    const byProject = new Map<string, typeof issues>();
    for (const i of issues) {
      const list = byProject.get(i.projectId as string) ?? [];
      list.push(i);
      byProject.set(i.projectId as string, list);
    }
    for (const p of projects) {
      const points = buildBurnupSeries(byProject.get(p.id) ?? [], now);
      out.set(p.id, {
        forecast: forecastCompletion(points),
        points,
        projectId: p.id,
        targetDate: p.targetDate ? toDateOnly(p.targetDate) : null,
      });
    }
    return out;
  }

  /**
   * Derived health for every live initiative (see lib/initiative-health). The
   * result is a hint: `manualHealth` carries the latest posted initiative
   * update so the UI can show that as the authoritative value.
   */
  async initiativeHealthRollups(
    orgId: string,
    scope: IssueVisibilityScope,
    now: Date = new Date(),
  ): Promise<InitiativeHealthRollup[]> {
    const initiatives = await this.prisma.initiative.findMany({
      select: {
        id: true,
        projects: {
          select: {
            project: {
              select: {
                archivedAt: true,
                health: true,
                healthUpdatedAt: true,
                id: true,
                statusType: true,
                targetDate: true,
              },
            },
          },
        },
        targetDate: true,
      },
      where: { archivedAt: null, organizationId: orgId },
    });
    const projects = new Map<
      string,
      {
        health: string | null;
        healthUpdatedAt: Date | null;
        id: string;
        statusType: string;
        targetDate: Date | null;
      }
    >();
    for (const i of initiatives) {
      for (const link of i.projects) {
        if (!link.project.archivedAt) {
          projects.set(link.project.id, link.project);
        }
      }
    }
    const projectIds = [...projects.keys()];
    const [burnups, projectUpdates, initiativeUpdates] = await Promise.all([
      this.projectBurnups(orgId, [...projects.values()], scope, now),
      projectIds.length === 0
        ? []
        : this.prisma.projectUpdate.findMany({
            distinct: ['projectId'],
            orderBy: [{ projectId: 'asc' }, { createdAt: 'desc' }],
            select: { createdAt: true, health: true, projectId: true },
            where: { archivedAt: null, projectId: { in: projectIds } },
          }),
      initiatives.length === 0
        ? []
        : this.prisma.initiativeUpdate.findMany({
            distinct: ['initiativeId'],
            orderBy: [{ initiativeId: 'asc' }, { createdAt: 'desc' }],
            select: { health: true, initiativeId: true },
            where: { archivedAt: null, initiativeId: { in: initiatives.map(i => i.id) } },
          }),
    ]);
    const latestUpdate = new Map(projectUpdates.map(u => [u.projectId, u]));
    const manualByInitiative = new Map(initiativeUpdates.map(u => [u.initiativeId, u.health]));
    const today = utcDay(now);

    return initiatives.map(i => {
      const inputs = i.projects
        .map(l => l.project)
        .filter(p => !p.archivedAt)
        .map(p => {
          // Newest of (project health field, latest project update) wins.
          const upd = latestUpdate.get(p.id);
          const useUpdate =
            upd && (!p.healthUpdatedAt || upd.createdAt.getTime() >= p.healthUpdatedAt.getTime());
          const forecast = burnups.get(p.id)?.forecast;
          return {
            id: p.id,
            manualHealth: (useUpdate ? upd.health : p.health) || null,
            projectedFinish:
              forecast?.status === 'projected' || forecast?.status === 'complete'
                ? forecast.projectedFinish
                : null,
            statusType: p.statusType,
            targetDate: p.targetDate ? toDateOnly(p.targetDate) : null,
          };
        });
      const derived = deriveInitiativeHealth(inputs, {
        initiativeTargetDate: i.targetDate ? toDateOnly(i.targetDate) : null,
        today,
      });
      return { ...derived, initiativeId: i.id, manualHealth: manualByInitiative.get(i.id) || null };
    });
  }

  /**
   * Insights v0: Measure x Slice over the caller's visible issues, optionally
   * narrowed by a saved view the caller can see. The view's filters are pushed
   * into the database `where`, so the INSIGHTS_SCAN_LIMIT cap applies to the
   * MATCHING rows, never to the unfiltered newest ones. Only the scalar
   * columns the measure needs are read; names are resolved for the slice's own
   * entities afterwards. Identical calls within INSIGHTS_CACHE_TTL_MS share one
   * scan (and a call already in flight is joined, not repeated).
   */
  async insights(
    orgId: string,
    userId: string,
    measure: string,
    slice: string,
    scope: IssueVisibilityScope,
    viewId?: string | null,
  ): Promise<InsightResult & { scanCapped: boolean }> {
    if (!(INSIGHT_MEASURES as readonly string[]).includes(measure)) {
      throw new InsightsInputError(`Unknown measure: ${measure}`);
    }
    if (!(INSIGHT_SLICES as readonly string[]).includes(slice)) {
      throw new InsightsInputError(`Unknown slice: ${slice}`);
    }
    const key = [
      orgId,
      userId,
      measure,
      slice,
      viewId ?? '',
      [...scope.hiddenTeamIds].sort().join(','),
      [...scope.guestTeamIds].sort().join(','),
    ].join('|');
    const now = Date.now();
    const hit = this.insightsCache.get(key);
    if (hit && hit.expires > now) {
      return hit.value;
    }
    const value = this.computeInsights(
      orgId,
      userId,
      measure as InsightMeasure,
      slice as InsightSlice,
      scope,
      viewId,
    );
    this.insightsCache.set(key, { expires: now + INSIGHTS_CACHE_TTL_MS, value });
    // A failed scan must not be cached; success entries are bounded.
    value.catch(() => {
      if (this.insightsCache.get(key)?.value === value) {
        this.insightsCache.delete(key);
      }
    });
    if (this.insightsCache.size > INSIGHTS_CACHE_MAX) {
      for (const [k, v] of this.insightsCache) {
        if (v.expires <= now || this.insightsCache.size > INSIGHTS_CACHE_MAX) {
          this.insightsCache.delete(k);
        }
      }
    }
    return value;
  }

  private readonly insightsCache = new Map<
    string,
    { expires: number; value: Promise<InsightResult & { scanCapped: boolean }> }
  >();

  private async computeInsights(
    orgId: string,
    userId: string,
    measure: InsightMeasure,
    slice: InsightSlice,
    scope: IssueVisibilityScope,
    viewId: string | null | undefined,
  ): Promise<InsightResult & { scanCapped: boolean }> {
    let viewTeamId: string | null = null;
    let viewWhere: Prisma.IssueWhereInput | null = null;
    if (viewId) {
      const view = await this.prisma.customView.findFirst({
        select: { filters: true, teamId: true },
        where: {
          archivedAt: null,
          id: viewId,
          OR: [{ creatorId: userId }, { shared: true }],
          organizationId: orgId,
        },
      });
      if (!view) {
        throw new InsightsInputError('View not found');
      }
      viewTeamId = view.teamId;
      const checked = validateFilterSet(view.filters);
      if (!checked.ok) {
        throw new InsightsInputError(`This view's filters are invalid: ${checked.error}`);
      }
      try {
        viewWhere = filterSetToWhere(checked.set);
      } catch (err) {
        if (err instanceof UnsupportedFilterError) {
          throw new InsightsInputError(err.message);
        }
        throw err;
      }
    }

    const rows = await this.prisma.issue.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        assigneeId: true,
        completedAt: true,
        estimate: true,
        priority: true,
        projectId: true,
        startedAt: true,
        stateId: true,
        teamId: true,
        ...(slice === 'label' ? { labelAssignments: { select: { labelId: true } } } : {}),
      },
      take: INSIGHTS_SCAN_LIMIT + 1,
      where: {
        AND: [
          issueVisibilityWhere(scope),
          ...(viewWhere ? [viewWhere] : []),
          {
            archivedAt: null,
            organizationId: orgId,
            trashed: false,
            ...(viewTeamId ? { teamId: viewTeamId } : {}),
          },
        ],
      },
    });
    const scanCapped = rows.length > INSIGHTS_SCAN_LIMIT;
    const scanned = scanCapped ? rows.slice(0, INSIGHTS_SCAN_LIMIT) : rows;

    const names = await this.insightNames(scanned, slice);
    const issues: InsightIssue[] = scanned.map(r => ({
      assignee: r.assigneeId
        ? { id: r.assigneeId, name: names.users.get(r.assigneeId) ?? r.assigneeId }
        : null,
      completedAt: r.completedAt,
      estimate: r.estimate,
      labels: ((r as { labelAssignments?: Array<{ labelId: string }> }).labelAssignments ?? []).map(
        l => ({ id: l.labelId, name: names.labels.get(l.labelId) ?? l.labelId }),
      ),
      priority: r.priority,
      project: r.projectId
        ? { id: r.projectId, name: names.projects.get(r.projectId) ?? r.projectId }
        : null,
      startedAt: r.startedAt,
      state: { name: names.states.get(r.stateId) ?? '' },
      team: { id: r.teamId, name: names.teams.get(r.teamId) ?? r.teamId },
    }));
    return { ...aggregateInsights(issues, measure, slice), scanCapped };
  }

  /** Display names for only the entities `slice` groups by. */
  private async insightNames(
    rows: Array<{
      assigneeId: string | null;
      projectId: string | null;
      stateId: string;
      teamId: string;
      labelAssignments?: Array<{ labelId: string }>;
    }>,
    slice: InsightSlice,
  ) {
    const out = {
      labels: new Map<string, string>(),
      projects: new Map<string, string>(),
      states: new Map<string, string>(),
      teams: new Map<string, string>(),
      users: new Map<string, string>(),
    };
    const ids = (pick: (r: (typeof rows)[number]) => string | null | undefined): string[] => [
      ...new Set(rows.map(pick).filter((v): v is string => !!v)),
    ];
    const fill = async (
      map: Map<string, string>,
      wanted: string[],
      fetch: (ids: string[]) => Promise<Array<{ id: string; name: string }>>,
    ) => {
      if (wanted.length === 0) {
        return;
      }
      for (const e of await fetch(wanted)) {
        map.set(e.id, e.name);
      }
    };
    const select = { id: true, name: true } as const;
    switch (slice) {
      case 'status':
        await fill(
          out.states,
          ids(r => r.stateId),
          idIn => this.prisma.workflowState.findMany({ select, where: { id: { in: idIn } } }),
        );
        break;
      case 'assignee':
        await fill(
          out.users,
          ids(r => r.assigneeId),
          idIn => this.prisma.user.findMany({ select, where: { id: { in: idIn } } }),
        );
        break;
      case 'label':
        await fill(
          out.labels,
          [...new Set(rows.flatMap(r => r.labelAssignments?.map(l => l.labelId) ?? []))],
          idIn => this.prisma.issueLabel.findMany({ select, where: { id: { in: idIn } } }),
        );
        break;
      case 'project':
        await fill(
          out.projects,
          ids(r => r.projectId),
          idIn => this.prisma.project.findMany({ select, where: { id: { in: idIn } } }),
        );
        break;
      case 'team':
        await fill(
          out.teams,
          ids(r => r.teamId),
          idIn => this.prisma.team.findMany({ select, where: { id: { in: idIn } } }),
        );
        break;
      default:
        break;
    }
    return out;
  }
}
