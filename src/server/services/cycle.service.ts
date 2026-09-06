import type { Cycle, PrismaClient } from '../../generated/prisma';
import { type ConfigReader, DEFAULTS_ONLY_CONFIG } from '../config/reader';
import { childLogger } from '../lib/logger';
import type { SyncService } from './sync.service';

const log = childLogger({ module: 'cycle-service' });

/** How many upcoming cycles `autoCreateUpcomingCycles` keeps pre-populated. */
const UPCOMING_CYCLE_COUNT_KEY = 'cycles.upcomingCount';

export interface CycleCreateInput {
  description?: string;
  endsAt: string;
  id?: string;
  name?: string;
  startsAt: string;
  teamId: string;
}

export interface CycleUpdateInput {
  description?: string | null;
  endsAt?: string;
  name?: string | null;
  startsAt?: string;
}

export class CycleNotFoundError extends Error {
  constructor() {
    super('Cycle not found');
    this.name = 'CycleNotFoundError';
  }
}

export class CycleOverlapError extends Error {
  constructor() {
    super('Cycle dates overlap with an existing cycle');
    this.name = 'CycleOverlapError';
  }
}

export class CycleInvalidDatesError extends Error {
  constructor() {
    super('Cycle end date must be after start date');
    this.name = 'CycleInvalidDatesError';
  }
}

export class CycleCrossTeamError extends Error {
  constructor() {
    super('Issue and cycle belong to different teams');
    this.name = 'CycleCrossTeamError';
  }
}

/**
 * Optional collaborators. `sync` is what `processDueRollovers` uses to emit
 * the SyncActions for the cycles and issues it touches — the WS scheduler
 * injects the real `SyncService`; request-path callers that never invoke
 * the sweep can leave it out.
 */
export interface CycleServiceDeps {
  sync?: Pick<SyncService, 'createSyncAction'>;
}

export class CycleService {
  constructor(
    private prisma: PrismaClient,
    private config: ConfigReader = DEFAULTS_ONLY_CONFIG,
    private readonly deps: CycleServiceDeps = {},
  ) {}

  async create(orgId: string, input: CycleCreateInput): Promise<Cycle> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (endsAt <= startsAt) {
      throw new CycleInvalidDatesError();
    }

    // `(teamId, number)` is unique. At Postgres' default READ COMMITTED
    // isolation, two concurrent creates on the same team can both read
    // max(number) and pick number+1, with one of them failing the unique
    // constraint at INSERT (Prisma P2002). Retry a small number of times
    // on that specific conflict so the slower request silently picks the
    // next number rather than surfacing an opaque error to the caller.
    const MAX_NUMBER_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async tx => {
          const overlap = await tx.cycle.findFirst({
            where: {
              archivedAt: null,
              endsAt: { gt: startsAt },
              startsAt: { lt: endsAt },
              teamId: input.teamId,
            },
          });
          if (overlap) {
            throw new CycleOverlapError();
          }

          const lastCycle = await tx.cycle.findFirst({
            orderBy: { number: 'desc' },
            select: { number: true },
            where: { teamId: input.teamId },
          });
          const number = (lastCycle?.number ?? 0) + 1;

          return tx.cycle.create({
            data: {
              ...(input.id ? { id: input.id } : {}),
              description: input.description ?? null,
              endsAt,
              name: input.name ?? null,
              number,
              organizationId: orgId,
              startsAt,
              teamId: input.teamId,
            },
          });
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'P2002' && attempt < MAX_NUMBER_RETRIES - 1) {
          continue;
        }
        throw err;
      }
    }
    // Unreachable — the loop either returns or throws.
    throw new Error('Failed to allocate cycle number after retries');
  }

  async update(id: string, input: CycleUpdateInput): Promise<Cycle> {
    const data: Record<string, unknown> = {};

    if ('name' in input) {
      data.name = input.name;
    }
    if ('description' in input) {
      data.description = input.description;
    }
    if (input.startsAt !== undefined) {
      data.startsAt = new Date(input.startsAt);
    }
    if (input.endsAt !== undefined) {
      data.endsAt = new Date(input.endsAt);
    }

    if (data.startsAt || data.endsAt) {
      const existing = await this.prisma.cycle.findUnique({ where: { id } });
      if (!existing) {
        throw new CycleNotFoundError();
      }

      const newStart = (data.startsAt as Date) ?? existing.startsAt;
      const newEnd = (data.endsAt as Date) ?? existing.endsAt;

      if (newEnd <= newStart) {
        throw new CycleInvalidDatesError();
      }

      // Check for overlapping cycles (excluding self)
      const overlap = await this.prisma.cycle.findFirst({
        where: {
          archivedAt: null,
          endsAt: { gt: newStart },
          id: { not: id },
          startsAt: { lt: newEnd },
          teamId: existing.teamId,
        },
      });
      if (overlap) {
        throw new CycleOverlapError();
      }
    }

    return this.prisma.cycle.update({
      data,
      where: { id },
    });
  }

  async archive(id: string): Promise<Cycle> {
    return this.prisma.cycle.update({
      data: { archivedAt: new Date() },
      where: { id },
    });
  }

  /**
   * Delete a cycle. Unassigns any issues currently on it (returning the
   * affected ids so the caller can emit one `'U' Issue` SyncAction per row
   * — without that, remote clients keep showing those issues on a cycle
   * that no longer exists until the next bootstrap).
   */
  async delete(id: string): Promise<{ cycle: Cycle; unassignedIssueIds: string[] }> {
    // Wrap the unassign + delete in one transaction: otherwise a failure
    // after updateMany but before delete would silently strip issues off a
    // cycle that still exists (partial-write window).
    return this.prisma.$transaction(async tx => {
      const affected = await tx.issue.findMany({
        select: { id: true },
        where: { cycleId: id },
      });
      await tx.issue.updateMany({
        data: { addedToCycleAt: null, cycleId: null },
        where: { cycleId: id },
      });
      const cycle = await tx.cycle.delete({ where: { id } });
      return { cycle, unassignedIssueIds: affected.map(i => i.id) };
    });
  }

  async findById(id: string): Promise<Cycle | null> {
    return this.prisma.cycle.findUnique({ where: { id } });
  }

  async findByTeamId(teamId: string, includeArchived = false): Promise<Cycle[]> {
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        teamId,
      },
    });
  }

  async findByOrgId(orgId: string, includeArchived = false): Promise<Cycle[]> {
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      where: {
        ...(includeArchived ? {} : { archivedAt: null }),
        organizationId: orgId,
      },
    });
  }

  async getActiveCycle(teamId: string): Promise<Cycle | null> {
    const now = new Date();
    return this.prisma.cycle.findFirst({
      where: {
        archivedAt: null,
        completedAt: null,
        endsAt: { gt: now },
        startsAt: { lte: now },
        teamId,
      },
    });
  }

  async getUpcomingCycles(teamId: string): Promise<Cycle[]> {
    const now = new Date();
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'asc' },
      where: {
        archivedAt: null,
        startsAt: { gt: now },
        teamId,
      },
    });
  }

  async getCompletedCycles(teamId: string): Promise<Cycle[]> {
    const now = new Date();
    return this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      where: {
        archivedAt: null,
        OR: [{ completedAt: { not: null } }, { endsAt: { lte: now } }],
        teamId,
      },
    });
  }

  /**
   * Roll over a cycle: mark it completed and move all incomplete issues
   * to the target cycle (or the next upcoming cycle for the team).
   * All mutations run in a single transaction to prevent partial rollover.
   */
  async rollover(
    orgId: string,
    cycleId: string,
  ): Promise<{
    movedCount: number;
    nextCycleId: string | null;
    movedIssueIds: string[];
  }> {
    const cycle = await this.prisma.cycle.findFirst({
      where: { id: cycleId, organizationId: orgId },
    });
    if (!cycle) {
      throw new CycleNotFoundError();
    }

    return this.prisma.$transaction(async tx => {
      // Mark the cycle completed
      await tx.cycle.update({
        data: { completedAt: new Date() },
        where: { id: cycleId },
      });

      // Find incomplete issues (not in completed/cancelled state)
      const incompleteIssues = await tx.issue.findMany({
        include: { state: { select: { type: true } } },
        where: {
          archivedAt: null,
          cycleId,
          trashed: false,
        },
      });

      const toMove = incompleteIssues.filter(
        i => i.state.type !== 'completed' && i.state.type !== 'canceled',
      );

      // Find the next contiguous cycle for this org+team. The sweep runs
      // AFTER the rolled-over cycle's endsAt has passed, so by the time
      // this fires the correct next cycle has typically already started
      // (startsAt <= now) — filtering on `startsAt: { gte: now }` would
      // exclude it and skip carryover issues ahead to whatever cycle
      // starts next, or unassign them entirely if none does. Instead,
      // select the earliest non-archived, not-yet-ended cycle (excluding
      // the one being rolled over) — matching the codebase's exclusive-
      // endsAt convention (see SyncAction commit watermark / burndown).
      const now = new Date();
      const nextCycle = await tx.cycle.findFirst({
        orderBy: { startsAt: 'asc' },
        where: {
          archivedAt: null,
          endsAt: { gt: now },
          id: { not: cycleId },
          organizationId: orgId,
          teamId: cycle.teamId,
        },
      });

      if (toMove.length > 0 && nextCycle) {
        await tx.issue.updateMany({
          data: { addedToCycleAt: new Date(), cycleId: nextCycle.id },
          where: { id: { in: toMove.map(i => i.id) } },
        });
        // Record how many issues were carried into the next cycle so the
        // analytics carryover-rate metric has an exact count (not heuristic).
        await tx.cycle.update({
          data: { carryoverCount: { increment: toMove.length } },
          where: { id: nextCycle.id },
        });
      } else if (toMove.length > 0) {
        // No next cycle — unassign issues
        await tx.issue.updateMany({
          data: { addedToCycleAt: null, cycleId: null },
          where: { id: { in: toMove.map(i => i.id) } },
        });
      }

      return {
        movedCount: toMove.length,
        movedIssueIds: toMove.map(i => i.id),
        nextCycleId: nextCycle?.id ?? null,
      };
    });
  }

  /**
   * Get velocity data for the last N completed cycles.
   */
  async getVelocity(
    teamId: string,
    cycleCount = 8,
  ): Promise<{
    averageIssues: number;
    cycles: Array<{
      completedIssues: number;
      completedPoints: number;
      cycleId: string;
      cycleNumber: number;
    }>;
  }> {
    const now = new Date();
    const completedCycles = await this.prisma.cycle.findMany({
      orderBy: { startsAt: 'desc' },
      take: cycleCount,
      where: {
        archivedAt: null,
        OR: [{ completedAt: { not: null } }, { endsAt: { lte: now } }],
        teamId,
      },
    });

    if (completedCycles.length === 0) {
      return { averageIssues: 0, cycles: [] };
    }

    // One aggregate over every cycle in the window instead of a findMany
    // per cycle; cycles with no completed issues get no group and fall
    // back to zero below.
    const groups = await this.prisma.issue.groupBy({
      _count: { _all: true },
      _sum: { estimate: true },
      by: ['cycleId'],
      where: {
        archivedAt: null,
        completedAt: { not: null },
        cycleId: { in: completedCycles.map(c => c.id) },
        trashed: false,
      },
    });
    const byCycleId = new Map(groups.map(g => [g.cycleId, g]));

    const cycles = completedCycles.map(cycle => {
      const group = byCycleId.get(cycle.id);
      return {
        completedIssues: group?._count._all ?? 0,
        completedPoints: group?._sum.estimate ?? 0,
        cycleId: cycle.id,
        cycleNumber: cycle.number,
      };
    });

    const averageIssues =
      cycles.length > 0 ? cycles.reduce((sum, c) => sum + c.completedIssues, 0) / cycles.length : 0;

    return { averageIssues, cycles };
  }

  /**
   * Compute burndown data for a cycle using issue completedAt timestamps.
   */
  async getBurndown(
    cycleId: string,
  ): Promise<Array<{ date: string; remaining: number; completed: number; scope: number }>> {
    const cycle = await this.prisma.cycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) {
      return [];
    }

    const issues = await this.prisma.issue.findMany({
      select: { addedToCycleAt: true, completedAt: true, id: true },
      where: { archivedAt: null, cycleId, trashed: false },
    });

    if (issues.length === 0) {
      return [];
    }

    const start = new Date(cycle.startsAt);
    const end = new Date(Math.min(cycle.endsAt.getTime(), Date.now()));

    // Sort completed timestamps ascending — walk a single pointer as days
    // advance: O(days + n) instead of O(days × n).
    const completedDates = issues
      .filter(i => i.completedAt !== null)
      .map(i => i.completedAt as Date)
      .sort((a, b) => a.getTime() - b.getTime());

    // Scope tracking: issues with no addedToCycleAt were in scope from cycle
    // start; issues with a timestamp entered scope on that day.
    const baseScope = issues.filter(i => i.addedToCycleAt == null).length;
    const scopeAdditions = issues
      .filter(i => i.addedToCycleAt != null)
      .map(i => i.addedToCycleAt as Date)
      .sort((a, b) => a.getTime() - b.getTime());

    const points: Array<{
      date: string;
      remaining: number;
      completed: number;
      scope: number;
    }> = [];
    const current = new Date(start);
    current.setUTCHours(0, 0, 0, 0);
    let completedIdx = 0;
    let scopeIdx = 0;
    let scopeOnDay = baseScope;

    while (current <= end) {
      const dayEnd = new Date(current);
      dayEnd.setUTCHours(23, 59, 59, 999);

      while (scopeIdx < scopeAdditions.length && scopeAdditions[scopeIdx] <= dayEnd) {
        scopeOnDay++;
        scopeIdx++;
      }

      while (completedIdx < completedDates.length && completedDates[completedIdx] <= dayEnd) {
        completedIdx++;
      }

      points.push({
        completed: completedIdx,
        date: current.toISOString().slice(0, 10),
        remaining: Math.max(0, scopeOnDay - completedIdx),
        scope: scopeOnDay,
      });

      current.setUTCDate(current.getUTCDate() + 1);
    }

    return points;
  }

  /**
   * Auto-rollover all cycles whose endsAt has passed but haven't been
   * completed yet. Called by the WS server on a scheduled interval.
   *
   * Emits the SyncActions for each rolled-over cycle and every issue it
   * moved (through `deps.sync`), so any caller keeps the "every mutation
   * creates a SyncAction" invariant without re-implementing it. Returns
   * one entry per rolled-over cycle.
   */
  async processDueRollovers(): Promise<
    Array<{ cycleId: string; orgId: string; movedIssueIds: string[] }>
  > {
    const now = new Date();
    const due = await this.prisma.cycle.findMany({
      select: { id: true, organizationId: true },
      where: { archivedAt: null, completedAt: null, endsAt: { lte: now } },
    });

    const results: Array<{ cycleId: string; orgId: string; movedIssueIds: string[] }> = [];
    for (const cycle of due) {
      const orgId = cycle.organizationId;
      let movedIssueIds: string[];
      try {
        movedIssueIds = (await this.rollover(orgId, cycle.id)).movedIssueIds;
      } catch (err) {
        log.error({ cycleId: cycle.id, err, orgId }, 'Auto-rollover failed for cycle');
        continue;
      }
      results.push({ cycleId: cycle.id, movedIssueIds, orgId });
      log.info({ cycleId: cycle.id, movedCount: movedIssueIds.length }, 'Auto-rolled over cycle');

      try {
        await this.emitRolloverSyncActions(orgId, cycle.id, movedIssueIds);
      } catch (err) {
        log.error(
          { cycleId: cycle.id, err, orgId },
          'Failed to emit SyncActions for rolled-over cycle',
        );
      }
    }
    return results;
  }

  private async emitRolloverSyncActions(
    orgId: string,
    cycleId: string,
    movedIssueIds: string[],
  ): Promise<void> {
    const sync = this.deps.sync;
    if (!sync) {
      log.warn({ cycleId, orgId }, 'No SyncService injected; rolled-over cycle not broadcast');
      return;
    }
    // Fetch the full cycle record so the SyncAction data replaces the
    // client's cached entity correctly (not just 2 fields).
    const cycle = await this.prisma.cycle.findUnique({ where: { id: cycleId } });
    if (cycle) {
      await sync.createSyncAction(orgId, 'U', 'Cycle', cycleId, cycle);
    }
    if (movedIssueIds.length > 0) {
      const movedIssues = await this.prisma.issue.findMany({
        where: { id: { in: movedIssueIds } },
      });
      for (const issue of movedIssues) {
        await sync.createSyncAction(orgId, 'U', 'Issue', issue.id, issue);
      }
    }
  }

  async addIssueToCycle(
    cycleId: string,
    issueId: string,
    cycleTeamId: string,
    issueTeamId: string,
  ): Promise<void> {
    if (cycleTeamId !== issueTeamId) {
      throw new CycleCrossTeamError();
    }
    await this.prisma.issue.update({
      data: { addedToCycleAt: new Date(), cycleId },
      where: { id: issueId },
    });
  }

  async removeIssueFromCycle(issueId: string): Promise<void> {
    await this.prisma.issue.update({
      data: { addedToCycleAt: null, cycleId: null },
      where: { id: issueId },
    });
  }

  /**
   * Live progress for any number of cycles, in two `groupBy` queries.
   *
   * `scope` is the live issue count and `progress` the completed fraction of
   * it — both derived from the issue set on read. There are deliberately no
   * `cycles.progress`/`scope` columns to cache this into: the ones that used
   * to exist were never written by anything, so every reader saw 0 (see
   * DATABASE_SCHEMA.md §2.9-pre).
   *
   * "Done" is `state.type` in (`completed`, `canceled`) rather than
   * `completedAt IS NOT NULL`, which is what the previous per-cycle
   * implementation used and is the right rule here: a canceled issue is
   * resolved and must leave the remaining work, but it never gets a
   * `completedAt` stamp. (`ProjectService.getProgressBatch` differs on
   * purpose — see the note there.)
   *
   * Guarantees an entry for every requested id, including cycles with no
   * issues at all, so the DataLoader's key-order projection can't misalign.
   */
  async getProgressBatch(
    cycleIds: string[],
  ): Promise<Map<string, { progress: number; scope: number }>> {
    const result = new Map<string, { progress: number; scope: number }>();
    if (cycleIds.length === 0) {
      return result;
    }

    const live = { archivedAt: null, cycleId: { in: cycleIds }, trashed: false } as const;
    const [totals, completed] = await Promise.all([
      this.prisma.issue.groupBy({ _count: true, by: ['cycleId'], where: live }),
      this.prisma.issue.groupBy({
        _count: true,
        by: ['cycleId'],
        where: { ...live, state: { type: { in: ['completed', 'canceled'] } } },
      }),
    ]);

    const completedByCycle = new Map<string, number>();
    for (const row of completed) {
      if (row.cycleId) {
        completedByCycle.set(row.cycleId, row._count);
      }
    }
    for (const row of totals) {
      if (!row.cycleId) {
        continue;
      }
      const total = row._count;
      const done = completedByCycle.get(row.cycleId) ?? 0;
      result.set(row.cycleId, { progress: total > 0 ? done / total : 0, scope: total });
    }
    for (const id of cycleIds) {
      if (!result.has(id)) {
        result.set(id, { progress: 0, scope: 0 });
      }
    }
    return result;
  }

  /**
   * Auto-create upcoming cycles for a team based on its cycle configuration.
   * Creates cycles up to `count` into the future — defaulting to the team's
   * configured `upcomingCycleCount` (Team.upcomingCycleCount, default 15) when
   * the caller doesn't pass an explicit override.
   */
  async autoCreateUpcomingCycles(orgId: string, teamId: string, count?: number): Promise<Cycle[]> {
    const team = await this.prisma.team.findUnique({
      select: {
        cycleCooldownTime: true,
        cycleDuration: true,
        cycleStartDay: true,
        cyclesEnabled: true,
      },
      where: { id: teamId },
    });

    if (!team?.cyclesEnabled) {
      return [];
    }

    // Resolved at team scope, falling through to the org and then the platform
    // default. This was `Team.upcomingCycleCount` — a column no API could set,
    // so it was only ever changeable with psql.
    const targetCount =
      count ??
      (await this.config.getInt(UPCOMING_CYCLE_COUNT_KEY, {
        orgId,
        teamId,
      }));
    const durationWeeks = team.cycleDuration ?? 2;
    const cooldownDays = team.cycleCooldownTime ?? 0;

    // Find the latest cycle to start from
    const latestCycle = await this.prisma.cycle.findFirst({
      orderBy: { endsAt: 'desc' },
      where: { archivedAt: null, teamId },
    });

    const existingUpcoming = await this.getUpcomingCycles(teamId);
    const toCreate = targetCount - existingUpcoming.length;
    if (toCreate <= 0) {
      return [];
    }

    // All date arithmetic is in UTC so a cycle boundary is the same instant
    // on every host — local `setDate`/`setHours` would move it by the
    // process's TZ offset (and by an hour across DST).
    let nextStart: Date;
    if (latestCycle) {
      nextStart = new Date(latestCycle.endsAt);
      nextStart.setUTCDate(nextStart.getUTCDate() + cooldownDays);
    } else {
      nextStart = new Date();
      // Align to the team's start day (1=Monday, 7=Sunday)
      const startDay = team.cycleStartDay ?? 1;
      const currentDay = nextStart.getUTCDay() || 7; // Convert 0 (Sunday) to 7
      const daysUntilStart = (startDay - currentDay + 7) % 7;
      nextStart.setUTCDate(nextStart.getUTCDate() + daysUntilStart);
      nextStart.setUTCHours(0, 0, 0, 0);
    }

    // Build all cycle date ranges first, then create them in a single
    // transaction to prevent overlapping cycles from concurrent calls.
    const ranges: Array<{ startsAt: Date; endsAt: Date }> = [];
    for (let i = 0; i < toCreate; i++) {
      const endsAt = new Date(nextStart);
      endsAt.setUTCDate(endsAt.getUTCDate() + durationWeeks * 7);
      ranges.push({ endsAt, startsAt: new Date(nextStart) });
      nextStart = new Date(endsAt);
      nextStart.setUTCDate(nextStart.getUTCDate() + cooldownDays);
    }

    return this.prisma.$transaction(async tx => {
      const created: Cycle[] = [];

      // Get the current max cycle number inside the transaction
      const lastCycle = await tx.cycle.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
        where: { teamId },
      });
      let nextNumber = (lastCycle?.number ?? 0) + 1;

      for (const range of ranges) {
        const cycle = await tx.cycle.create({
          data: {
            endsAt: range.endsAt,
            number: nextNumber,
            organizationId: orgId,
            startsAt: range.startsAt,
            teamId,
          },
        });
        created.push(cycle);
        nextNumber++;
      }

      return created;
    });
  }
}
