import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_TEAM } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { AnalyticsService } from './analytics.service';

const ORG_ID = TEST_ORG.id;
const TEAM_ID = TEST_TEAM.id;

describe('AnalyticsService', () => {
  let prisma: MockPrismaClient;
  let service: AnalyticsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    prisma = createMockPrisma();
    service = new AnalyticsService(prisma as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('leadTimeHistogram', () => {
    it('buckets raw day samples on the Fibonacci-ish edges', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { days: 0 },
        { days: 0.5 },
        { days: 1 },
        { days: 4 },
        { days: 12 },
        { days: 50 },
      ]);

      const result = await service.leadTimeHistogram({ orgId: ORG_ID });

      // [0,1) -> 2, [1,2) -> 1, [3,5) -> 1, [8,13) -> 1, [34,inf) -> 1
      expect(result).toHaveLength(9);
      expect(result[0]).toEqual({ bucketEnd: 1, bucketStart: 0, count: 2 });
      expect(result[1]).toEqual({ bucketEnd: 2, bucketStart: 1, count: 1 });
      expect(result[3]).toEqual({ bucketEnd: 5, bucketStart: 3, count: 1 });
      expect(result[5]).toEqual({ bucketEnd: 13, bucketStart: 8, count: 1 });
      expect(result[8]).toEqual({ bucketEnd: Number.POSITIVE_INFINITY, bucketStart: 34, count: 1 });
    });

    it('coerces string/numeric day values via Number()', async () => {
      prisma.$queryRaw.mockResolvedValue([{ days: '2.5' }, { days: '7' }]);

      const result = await service.leadTimeHistogram({ orgId: ORG_ID });

      // 2.5 -> [2,3) at index 2, 7 -> [5,8) at index 4
      expect(result[2]).toEqual({ bucketEnd: 3, bucketStart: 2, count: 1 });
      expect(result[4]).toEqual({ bucketEnd: 8, bucketStart: 5, count: 1 });
    });

    it('returns all-zero buckets for no rows', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.leadTimeHistogram({ orgId: ORG_ID });

      expect(result).toHaveLength(9);
      expect(result.every(b => b.count === 0)).toBe(true);
    });
  });

  describe('cycleTimeHistogram', () => {
    it('buckets completed-minus-started day samples', async () => {
      prisma.$queryRaw.mockResolvedValue([{ days: 1.5 }, { days: 30 }]);

      const result = await service.cycleTimeHistogram({
        orgId: ORG_ID,
        range: { from: '2026-01-01', to: '2026-06-01' },
        teamId: TEAM_ID,
      });

      expect(result[1]).toEqual({ bucketEnd: 2, bucketStart: 1, count: 1 });
      expect(result[7]).toEqual({ bucketEnd: 34, bucketStart: 21, count: 1 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('throughputByWeek', () => {
    it('maps week_start dates and bigint counts to wire rows', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { count: BigInt(3), week_start: new Date('2026-06-01T00:00:00Z') },
        { count: BigInt(5), week_start: new Date('2026-06-08T00:00:00Z') },
      ]);

      const result = await service.throughputByWeek({ orgId: ORG_ID });

      expect(result).toEqual([
        { count: 3, weekStart: '2026-06-01' },
        { count: 5, weekStart: '2026-06-08' },
      ]);
    });

    it('returns an empty array when nothing completed', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.throughputByWeek({ orgId: ORG_ID });

      expect(result).toEqual([]);
    });
  });

  describe('teamHealth', () => {
    it('derives counts, percentiles and the unestimated percentage', async () => {
      // Returned ordered by age_days DESC per the query; service re-sorts ascending.
      prisma.$queryRaw.mockResolvedValue([
        { age_days: 40, estimate: null, is_overdue: true },
        { age_days: 30, estimate: 3, is_overdue: false },
        { age_days: 20, estimate: null, is_overdue: true },
        { age_days: 10, estimate: 5, is_overdue: false },
      ]);

      const result = await service.teamHealth({ orgId: ORG_ID, teamId: TEAM_ID });

      expect(result.openCount).toBe(4);
      expect(result.overdueCount).toBe(2);
      expect(result.unestimatedCount).toBe(2);
      expect(result.unestimatedPct).toBe(50);
      expect(result.oldestOpenAgeDays).toBe(40);
      // sorted asc: [10,20,30,40], idx = floor(4 * 0.75) = 3 -> 40
      expect(result.p75AgeDays).toBe(40);
    });

    it('returns zeroed stats for a team with no open issues', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.teamHealth({ orgId: ORG_ID });

      expect(result).toEqual({
        oldestOpenAgeDays: 0,
        openCount: 0,
        overdueCount: 0,
        p75AgeDays: 0,
        unestimatedCount: 0,
        unestimatedPct: 0,
      });
    });
  });

  describe('cycleVelocityTrend', () => {
    function makeCycle(id: string, number: number, startsAt: string) {
      return {
        id,
        number,
        startsAt: new Date(startsAt),
      };
    }

    it('computes per-cycle velocity and rolling averages in chronological order', async () => {
      // Cycles returned newest-first (orderBy startsAt desc).
      prisma.cycle.findMany.mockResolvedValue([
        makeCycle('c3', 3, '2026-05-01T00:00:00Z'),
        makeCycle('c2', 2, '2026-04-01T00:00:00Z'),
        makeCycle('c1', 1, '2026-03-01T00:00:00Z'),
      ]);

      // issue.findMany is called once per cycle, in the order findMany returned.
      prisma.issue.findMany
        .mockResolvedValueOnce([{ estimate: 2 }, { estimate: 3 }]) // c3: 2 issues, 5 pts
        .mockResolvedValueOnce([{ estimate: null }]) // c2: 1 issue, 0 pts
        .mockResolvedValueOnce([{ estimate: 8 }, { estimate: 1 }, { estimate: 1 }]); // c1: 3 issues, 10 pts

      const result = await service.cycleVelocityTrend({ orgId: ORG_ID, teamId: TEAM_ID });

      // chronological order: c1, c2, c3
      expect(result.cycles.map(c => c.cycleId)).toEqual(['c1', 'c2', 'c3']);
      expect(result.cycles[0]).toEqual({
        completedIssues: 3,
        completedPoints: 10,
        cycleId: 'c1',
        cycleNumber: 1,
        cycleStartsAt: '2026-03-01T00:00:00.000Z',
      });

      // rolling3 issues = (3 + 1 + 2) / 3 = 2
      expect(result.rolling3).toBe(2);
      // rolling3 points = (10 + 0 + 5) / 3 = 5
      expect(result.rolling3Points).toBe(5);
      // fewer than 6/12 cycles -> averages over the 3 available
      expect(result.rolling6).toBe(2);
      expect(result.rolling12Points).toBe(5);
    });

    it('honours the cycleCount limit via take', async () => {
      prisma.cycle.findMany.mockResolvedValue([]);

      const result = await service.cycleVelocityTrend({ cycleCount: 5, orgId: ORG_ID });

      expect(prisma.cycle.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
      expect(result.cycles).toEqual([]);
      expect(result.rolling3).toBe(0);
      expect(result.rolling12Points).toBe(0);
    });

    it('defaults the limit to 12 cycles', async () => {
      prisma.cycle.findMany.mockResolvedValue([]);

      await service.cycleVelocityTrend({ orgId: ORG_ID });

      expect(prisma.cycle.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 12 }));
    });
  });

  describe('cycleScopeAndCarryover', () => {
    it('subtracts carryover from raw scope-creep and derives percentages', async () => {
      prisma.cycle.findUnique.mockResolvedValue({ carryoverCount: 2 });
      // total, scopeCreep, completed (order matches the Promise.all array)
      prisma.issue.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(7);

      const result = await service.cycleScopeAndCarryover('c1');

      expect(result).toEqual({
        carryoverCount: 2,
        carryoverPct: 20,
        completedCount: 7,
        // planned = total - scopeCreep = 10 - 5 = 5
        plannedCount: 5,
        // trueScopeCreep = max(0, 5 - 2) = 3
        scopeCreepCount: 3,
        scopeCreepPct: 30,
        totalCount: 10,
      });
    });

    it('clamps negative scope-creep to zero when carryover exceeds added issues', async () => {
      prisma.cycle.findUnique.mockResolvedValue({ carryoverCount: 5 });
      prisma.issue.count.mockResolvedValueOnce(8).mockResolvedValueOnce(2).mockResolvedValueOnce(4);

      const result = await service.cycleScopeAndCarryover('c1');

      expect(result.scopeCreepCount).toBe(0);
      expect(result.scopeCreepPct).toBe(0);
      // plannedCount still uses raw scopeCreep, not the clamped value
      expect(result.plannedCount).toBe(6);
    });

    it('treats a missing cycle as zero carryover and avoids divide-by-zero', async () => {
      prisma.cycle.findUnique.mockResolvedValue(null);
      prisma.issue.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.cycleScopeAndCarryover('missing');

      expect(result).toEqual({
        carryoverCount: 0,
        carryoverPct: 0,
        completedCount: 0,
        plannedCount: 0,
        scopeCreepCount: 0,
        scopeCreepPct: 0,
        totalCount: 0,
      });
    });
  });

  describe('workspaceOverview', () => {
    it('aggregates per-team stats and sorts by completedCount desc', async () => {
      prisma.team.findMany.mockResolvedValue([
        { id: 'team-a', name: 'Alpha' },
        { id: 'team-b', name: 'Beta' },
      ]);

      // Two teams x (total, open, completed) counts, interleaved by Promise.all.
      // Team A: total 10, open 4, completed 6. Team B: total 5, open 5, completed 0.
      prisma.issue.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(6)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(0);

      prisma.$queryRaw
        .mockResolvedValueOnce([{ avg_days: 2.5 }])
        .mockResolvedValueOnce([{ avg_days: null }]);

      const result = await service.workspaceOverview(ORG_ID);

      expect(result.totalIssues).toBe(15);
      expect(result.totalOpen).toBe(9);
      expect(result.totalCompleted).toBe(6);

      // Alpha (completed 6) sorts ahead of Beta (completed 0).
      expect(result.teams.map(t => t.teamId)).toEqual(['team-a', 'team-b']);
      expect(result.teams[0]).toEqual({
        avgCycleTimeDays: 2.5,
        completedCount: 6,
        completionRate: 60,
        openCount: 4,
        teamId: 'team-a',
        teamName: 'Alpha',
        totalCount: 10,
      });
      // null avg_days coerces to 0; total 5 -> completionRate 0.
      expect(result.teams[1].avgCycleTimeDays).toBe(0);
      expect(result.teams[1].completionRate).toBe(0);
    });

    it('returns zeroed totals for an org with no teams', async () => {
      prisma.team.findMany.mockResolvedValue([]);

      const result = await service.workspaceOverview(ORG_ID);

      expect(result).toEqual({
        teams: [],
        totalCompleted: 0,
        totalIssues: 0,
        totalOpen: 0,
      });
    });
  });

  describe('timeInStateApprox', () => {
    it('maps rows, coercing null avg_hours to 0 and bigint samples to Number', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { avg_hours: 48.5, sample: BigInt(4), state_id: 's1' },
        { avg_hours: null, sample: BigInt(2), state_id: 's2' },
      ]);

      const result = await service.timeInStateApprox({ orgId: ORG_ID, teamId: TEAM_ID });

      expect(result).toEqual([
        { avgHours: 48.5, sampleSize: 4, stateId: 's1' },
        { avgHours: 0, sampleSize: 2, stateId: 's2' },
      ]);
    });

    it('returns an empty array when no started issues exist', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      const result = await service.timeInStateApprox({ orgId: ORG_ID });

      expect(result).toEqual([]);
    });
  });
});
