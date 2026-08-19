import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStubConfig } from '../../test/config-mock';
import { TEST_ORG, TEST_TEAM } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  CycleInvalidDatesError,
  CycleNotFoundError,
  CycleOverlapError,
  CycleService,
} from './cycle.service';

const TEST_CYCLE = {
  archivedAt: null,
  completedAt: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  description: null,
  endsAt: new Date('2026-03-15T00:00:00Z'),
  id: '00000000-0000-0000-0000-000000000600',
  name: 'Sprint 1',
  number: 1,
  organizationId: '00000000-0000-0000-0000-000000000001',
  startsAt: new Date('2026-03-01T00:00:00Z'),
  teamId: '00000000-0000-0000-0000-000000000100',
  updatedAt: new Date('2026-03-01T00:00:00Z'),
};

describe('CycleService', () => {
  let prisma: MockPrismaClient;
  let service: CycleService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CycleService(prisma as never);
  });

  describe('create', () => {
    it('creates a cycle with correct number', async () => {
      // findFirst for overlap check returns null (no overlap)
      prisma.cycle.findFirst.mockResolvedValueOnce(null);
      // findFirst for last cycle number
      prisma.cycle.findFirst.mockResolvedValueOnce({ number: 3 });
      prisma.cycle.create.mockResolvedValue(TEST_CYCLE);

      const result = await service.create(TEST_ORG.id, {
        endsAt: '2026-03-15T00:00:00Z',
        startsAt: '2026-03-01T00:00:00Z',
        teamId: TEST_TEAM.id,
      });

      expect(result).toEqual(TEST_CYCLE);
      expect(prisma.cycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 4,
            organizationId: TEST_ORG.id,
            teamId: TEST_TEAM.id,
          }),
        }),
      );
    });

    it('throws CycleOverlapError when dates overlap', async () => {
      // findFirst for overlap check returns an existing cycle
      prisma.cycle.findFirst.mockResolvedValueOnce(TEST_CYCLE);

      await expect(
        service.create(TEST_ORG.id, {
          endsAt: '2026-03-10T00:00:00Z',
          startsAt: '2026-03-05T00:00:00Z',
          teamId: TEST_TEAM.id,
        }),
      ).rejects.toThrow(CycleOverlapError);
    });

    it('throws CycleInvalidDatesError when end <= start', async () => {
      await expect(
        service.create(TEST_ORG.id, {
          endsAt: '2026-03-01T00:00:00Z',
          startsAt: '2026-03-15T00:00:00Z',
          teamId: TEST_TEAM.id,
        }),
      ).rejects.toThrow(CycleInvalidDatesError);
    });
  });

  describe('update', () => {
    it('updates cycle name and description', async () => {
      const updated = {
        ...TEST_CYCLE,
        description: 'Updated desc',
        name: 'Sprint 1 Updated',
      };
      prisma.cycle.update.mockResolvedValue(updated);

      const result = await service.update(TEST_CYCLE.id, {
        description: 'Updated desc',
        name: 'Sprint 1 Updated',
      });

      expect(result).toEqual(updated);
      expect(prisma.cycle.update).toHaveBeenCalledWith({
        data: { description: 'Updated desc', name: 'Sprint 1 Updated' },
        where: { id: TEST_CYCLE.id },
      });
    });

    it('checks for overlap on date changes', async () => {
      prisma.cycle.findUnique.mockResolvedValue(TEST_CYCLE);
      // findFirst for overlap check returns an existing cycle
      prisma.cycle.findFirst.mockResolvedValue({
        ...TEST_CYCLE,
        id: 'other-cycle',
      });

      await expect(
        service.update(TEST_CYCLE.id, {
          endsAt: '2026-04-01T00:00:00Z',
          startsAt: '2026-03-10T00:00:00Z',
        }),
      ).rejects.toThrow(CycleOverlapError);
    });
  });

  describe('archive', () => {
    it('sets archivedAt', async () => {
      const now = new Date();
      prisma.cycle.update.mockResolvedValue({
        ...TEST_CYCLE,
        archivedAt: now,
      });

      const result = await service.archive(TEST_CYCLE.id);
      expect(result.archivedAt).not.toBeNull();
      expect(prisma.cycle.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_CYCLE.id },
      });
    });
  });

  describe('delete', () => {
    it('unassigns issues, deletes cycle, and returns affected issue ids', async () => {
      prisma.issue.findMany.mockResolvedValue([{ id: 'i-1' }, { id: 'i-2' }]);
      prisma.issue.updateMany.mockResolvedValue({ count: 2 });
      prisma.cycle.delete.mockResolvedValue(TEST_CYCLE);

      const result = await service.delete(TEST_CYCLE.id);

      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: { addedToCycleAt: null, cycleId: null },
        where: { cycleId: TEST_CYCLE.id },
      });
      expect(prisma.cycle.delete).toHaveBeenCalledWith({
        where: { id: TEST_CYCLE.id },
      });
      expect(result.unassignedIssueIds).toEqual(['i-1', 'i-2']);
    });
  });

  describe('findByTeamId', () => {
    it('returns cycles for team', async () => {
      prisma.cycle.findMany.mockResolvedValue([TEST_CYCLE]);

      const result = await service.findByTeamId(TEST_TEAM.id);

      expect(result).toEqual([TEST_CYCLE]);
      expect(prisma.cycle.findMany).toHaveBeenCalledWith({
        orderBy: { startsAt: 'desc' },
        where: { archivedAt: null, teamId: TEST_TEAM.id },
      });
    });
  });

  describe('getActiveCycle', () => {
    it('returns current active cycle', async () => {
      prisma.cycle.findFirst.mockResolvedValue(TEST_CYCLE);

      const result = await service.getActiveCycle(TEST_TEAM.id);

      expect(result).toEqual(TEST_CYCLE);
      expect(prisma.cycle.findFirst).toHaveBeenCalledWith({
        where: {
          archivedAt: null,
          completedAt: null,
          endsAt: { gt: expect.any(Date) },
          startsAt: { lte: expect.any(Date) },
          teamId: TEST_TEAM.id,
        },
      });
    });
  });

  describe('addIssueToCycle', () => {
    it('updates issue with cycleId', async () => {
      const issueId = '00000000-0000-0000-0000-000000000400';
      prisma.issue.update.mockResolvedValue({
        cycleId: TEST_CYCLE.id,
        id: issueId,
      });

      await service.addIssueToCycle(TEST_CYCLE.id, issueId, TEST_CYCLE.teamId, TEST_CYCLE.teamId);

      expect(prisma.issue.update).toHaveBeenCalledWith({
        data: { addedToCycleAt: expect.any(Date), cycleId: TEST_CYCLE.id },
        where: { id: issueId },
      });
    });

    it('throws CycleCrossTeamError when teams differ', async () => {
      await expect(
        service.addIssueToCycle(
          TEST_CYCLE.id,
          '00000000-0000-0000-0000-000000000400',
          TEST_CYCLE.teamId,
          '00000000-0000-0000-0000-000000000099',
        ),
      ).rejects.toThrow('Issue and cycle belong to different teams');
    });
  });

  describe('rollover', () => {
    const NEXT_CYCLE = {
      ...TEST_CYCLE,
      endsAt: new Date('2026-03-30T00:00:00Z'),
      id: '00000000-0000-0000-0000-000000000601',
      number: 2,
      startsAt: new Date('2026-03-16T00:00:00Z'),
    };

    it('throws CycleNotFoundError when cycle not in org', async () => {
      prisma.cycle.findFirst.mockResolvedValue(null);

      await expect(service.rollover('wrong-org-id', TEST_CYCLE.id)).rejects.toThrow(
        CycleNotFoundError,
      );
    });

    it('marks cycle completed and moves incomplete issues to next cycle', async () => {
      const issueId = '00000000-0000-0000-0000-000000000400';
      prisma.cycle.findFirst.mockResolvedValueOnce(TEST_CYCLE); // org scope check
      prisma.cycle.update.mockResolvedValue({
        ...TEST_CYCLE,
        completedAt: new Date(),
      });
      prisma.issue.findMany.mockResolvedValue([
        {
          archivedAt: null,
          id: issueId,
          state: { type: 'started' },
          trashed: false,
        },
      ]);
      prisma.cycle.findFirst.mockResolvedValueOnce(NEXT_CYCLE); // next upcoming
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.rollover(TEST_ORG.id, TEST_CYCLE.id);

      expect(result.movedCount).toBe(1);
      expect(result.movedIssueIds).toEqual([issueId]);
      expect(result.nextCycleId).toBe(NEXT_CYCLE.id);
      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: { addedToCycleAt: expect.any(Date), cycleId: NEXT_CYCLE.id },
        where: { id: { in: [issueId] } },
      });
    });

    it('unassigns issues when no next cycle exists', async () => {
      const issueId = '00000000-0000-0000-0000-000000000400';
      prisma.cycle.findFirst.mockResolvedValueOnce(TEST_CYCLE); // org scope check
      prisma.cycle.update.mockResolvedValue({
        ...TEST_CYCLE,
        completedAt: new Date(),
      });
      prisma.issue.findMany.mockResolvedValue([
        {
          archivedAt: null,
          id: issueId,
          state: { type: 'backlog' },
          trashed: false,
        },
      ]);
      prisma.cycle.findFirst.mockResolvedValueOnce(null); // no next cycle
      prisma.issue.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.rollover(TEST_ORG.id, TEST_CYCLE.id);

      expect(result.movedCount).toBe(1);
      expect(result.nextCycleId).toBeNull();
      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: { addedToCycleAt: null, cycleId: null },
        where: { id: { in: [issueId] } },
      });
    });

    it('does not move already-completed or canceled issues', async () => {
      prisma.cycle.findFirst.mockResolvedValueOnce(TEST_CYCLE);
      prisma.cycle.update.mockResolvedValue({
        ...TEST_CYCLE,
        completedAt: new Date(),
      });
      prisma.issue.findMany.mockResolvedValue([
        { id: 'i1', state: { type: 'completed' } },
        { id: 'i2', state: { type: 'canceled' } },
      ]);
      prisma.cycle.findFirst.mockResolvedValueOnce(NEXT_CYCLE);

      const result = await service.rollover(TEST_ORG.id, TEST_CYCLE.id);

      expect(result.movedCount).toBe(0);
      expect(result.movedIssueIds).toEqual([]);
      expect(prisma.issue.updateMany).not.toHaveBeenCalled();
    });

    it('picks the contiguous next cycle (already started) when the sweep runs just after endsAt', async () => {
      // The completed cycle ends 2026-03-15; the sweep fires slightly
      // after that, by which point the contiguous next cycle (which also
      // starts 03-15) has ALREADY started. The old `startsAt: { gte: now }`
      // filter would have excluded it entirely, jumping carryover issues
      // ahead a cycle (or unassigning them if none started later).
      const now = new Date('2026-03-15T00:00:05Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        const CONTIGUOUS_NEXT_CYCLE = {
          ...TEST_CYCLE,
          endsAt: new Date('2026-03-29T00:00:00Z'),
          id: '00000000-0000-0000-0000-000000000602',
          number: 2,
          startsAt: new Date('2026-03-15T00:00:00Z'),
        };

        const issueId = '00000000-0000-0000-0000-000000000400';
        prisma.cycle.findFirst.mockResolvedValueOnce(TEST_CYCLE); // org scope check
        prisma.cycle.update.mockResolvedValue({ ...TEST_CYCLE, completedAt: new Date() });
        prisma.issue.findMany.mockResolvedValue([
          { archivedAt: null, id: issueId, state: { type: 'started' }, trashed: false },
        ]);
        prisma.cycle.findFirst.mockResolvedValueOnce(CONTIGUOUS_NEXT_CYCLE); // next-cycle lookup
        prisma.issue.updateMany.mockResolvedValue({ count: 1 });

        const result = await service.rollover(TEST_ORG.id, TEST_CYCLE.id);

        expect(result.nextCycleId).toBe(CONTIGUOUS_NEXT_CYCLE.id);
        // Assert the query shape, not just that the mock happened to
        // return the row handed to it: the lookup must filter on
        // `endsAt: { gt: now }` (the codebase's exclusive-endsAt
        // convention), NOT `startsAt: { gte: now }` — the latter would
        // exclude a cycle that has already started.
        const nextCycleCall = prisma.cycle.findFirst.mock.calls[1][0] as {
          where: Record<string, unknown>;
        };
        expect(nextCycleCall.where).toEqual({
          archivedAt: null,
          endsAt: { gt: now },
          id: { not: TEST_CYCLE.id },
          organizationId: TEST_ORG.id,
          teamId: TEST_CYCLE.teamId,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getProgressBatch', () => {
    // `groupBy` isn't part of the shared mock model (see
    // src/test/prisma-mock.ts) — added ad hoc here, matching the pattern in
    // project.service.test.ts.
    let issueGroupBy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      issueGroupBy = vi.fn().mockResolvedValue([]);
      (prisma.issue as unknown as { groupBy: typeof issueGroupBy }).groupBy = issueGroupBy;
    });

    it('returns an empty map without querying when given no ids', async () => {
      const result = await service.getProgressBatch([]);

      expect(result).toEqual(new Map());
      expect(issueGroupBy).not.toHaveBeenCalled();
    });

    it('computes per-cycle progress from two batched groupBy queries', async () => {
      issueGroupBy
        .mockResolvedValueOnce([
          { _count: 4, cycleId: 'c1' },
          { _count: 2, cycleId: 'c2' },
        ])
        .mockResolvedValueOnce([
          { _count: 1, cycleId: 'c1' },
          { _count: 2, cycleId: 'c2' },
        ]);

      const result = await service.getProgressBatch(['c1', 'c2']);

      expect(result).toEqual(
        new Map([
          ['c1', { progress: 0.25, scope: 4 }],
          ['c2', { progress: 1, scope: 2 }],
        ]),
      );
      expect(issueGroupBy).toHaveBeenCalledTimes(2);
    });

    it('counts canceled issues as done, not just completed ones', async () => {
      // The distinction that makes this differ from the project path: a
      // canceled issue is resolved and must leave the remaining work, but it
      // never gets a `completedAt` stamp.
      await service.getProgressBatch(['c1']);

      expect(issueGroupBy).toHaveBeenNthCalledWith(1, {
        _count: true,
        by: ['cycleId'],
        where: { archivedAt: null, cycleId: { in: ['c1'] }, trashed: false },
      });
      expect(issueGroupBy).toHaveBeenNthCalledWith(2, {
        _count: true,
        by: ['cycleId'],
        where: {
          archivedAt: null,
          cycleId: { in: ['c1'] },
          state: { type: { in: ['completed', 'canceled'] } },
          trashed: false,
        },
      });
    });

    it('returns a zero entry for a cycle with no issues, so the loader cannot misalign', async () => {
      issueGroupBy
        .mockResolvedValueOnce([{ _count: 2, cycleId: 'c1' }])
        .mockResolvedValueOnce([{ _count: 2, cycleId: 'c1' }]);

      const result = await service.getProgressBatch(['c1', 'empty']);

      expect(result.get('empty')).toEqual({ progress: 0, scope: 0 });
      expect(result.size).toBe(2);
    });
  });

  describe('getVelocity', () => {
    it('returns average and per-cycle completed issue counts', async () => {
      const cycle1 = { ...TEST_CYCLE, id: 'c1', number: 1 };
      const cycle2 = { ...TEST_CYCLE, id: 'c2', number: 2 };
      prisma.cycle.findMany.mockResolvedValue([cycle1, cycle2]);
      // getVelocity now calls issue.findMany (for story points), not issue.count
      prisma.issue.findMany
        .mockResolvedValueOnce([
          { estimate: 2 },
          { estimate: null },
          { estimate: 1 },
          { estimate: 1 },
        ]) // 4 issues, 4 pts
        .mockResolvedValueOnce([
          { estimate: 3 },
          { estimate: 2 },
          { estimate: null },
          { estimate: 1 },
          { estimate: 0 },
          { estimate: 2 },
        ]); // 6 issues, 8 pts

      const result = await service.getVelocity(TEST_TEAM.id, 8);

      expect(result.averageIssues).toBe(5);
      expect(result.cycles).toEqual([
        { completedIssues: 4, completedPoints: 4, cycleId: 'c1', cycleNumber: 1 },
        { completedIssues: 6, completedPoints: 8, cycleId: 'c2', cycleNumber: 2 },
      ]);
    });

    it('returns zero average when no completed cycles', async () => {
      prisma.cycle.findMany.mockResolvedValue([]);

      const result = await service.getVelocity(TEST_TEAM.id);

      expect(result.averageIssues).toBe(0);
      expect(result.cycles).toEqual([]);
    });
  });

  describe('getBurndown', () => {
    it('returns empty array when cycle not found', async () => {
      prisma.cycle.findUnique.mockResolvedValue(null);

      const result = await service.getBurndown('nonexistent');
      expect(result).toEqual([]);
    });

    it('returns empty array when cycle has no issues', async () => {
      prisma.cycle.findUnique.mockResolvedValue(TEST_CYCLE);
      prisma.issue.findMany.mockResolvedValue([]);

      const result = await service.getBurndown(TEST_CYCLE.id);
      expect(result).toEqual([]);
    });

    it('produces day-by-day burndown points', async () => {
      const start = new Date('2026-03-01T00:00:00Z');
      const end = new Date('2026-03-03T00:00:00Z'); // 3-day cycle for brevity
      const cycle = { ...TEST_CYCLE, endsAt: end, startsAt: start };
      prisma.cycle.findUnique.mockResolvedValue(cycle);
      prisma.issue.findMany.mockResolvedValue([
        { addedToCycleAt: null, completedAt: new Date('2026-03-01T12:00:00Z'), id: 'i1' },
        { addedToCycleAt: null, completedAt: null, id: 'i2' },
      ]);

      const result = await service.getBurndown(TEST_CYCLE.id);

      // Expect a data point for each day from start up to min(end, now)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].date).toBe('2026-03-01');
      // After day 1: 1 issue completed, 1 remaining, scope = 2
      const day1 = result.find(p => p.date === '2026-03-01');
      expect(day1?.completed).toBe(1);
      expect(day1?.remaining).toBe(1);
      expect(day1?.scope).toBe(2);
    });
  });

  describe('autoCreateUpcomingCycles', () => {
    // `upcomingCycleCount` is no longer a Team column — it is the
    // `cycles.upcomingCount` registry knob, resolved at team scope.
    const CYCLES_TEAM = {
      cycleCooldownTime: 0,
      cycleDuration: 2,
      cycleStartDay: 1,
      cyclesEnabled: true,
    };

    it('defaults to the team-configured upcomingCycleCount (no explicit count passed)', async () => {
      prisma.team.findUnique.mockResolvedValue(CYCLES_TEAM);
      prisma.cycle.findFirst.mockResolvedValue(null); // no existing cycles
      prisma.cycle.findMany.mockResolvedValue([]); // no existing upcoming
      prisma.cycle.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...TEST_CYCLE, ...data }),
      );

      const result = await service.autoCreateUpcomingCycles(TEST_ORG.id, TEST_TEAM.id);

      // Team's upcomingCycleCount default (15) minus 0 existing = 15 created.
      expect(result).toHaveLength(15);
    });

    it('honours a team-configured upcomingCycleCount override', async () => {
      service = new CycleService(prisma as never, createStubConfig({ 'cycles.upcomingCount': 3 }));
      prisma.team.findUnique.mockResolvedValue(CYCLES_TEAM);
      prisma.cycle.findFirst.mockResolvedValue(null);
      prisma.cycle.findMany.mockResolvedValue([]);
      prisma.cycle.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...TEST_CYCLE, ...data }),
      );

      const result = await service.autoCreateUpcomingCycles(TEST_ORG.id, TEST_TEAM.id);

      expect(result).toHaveLength(3);
    });

    it('an explicit count argument still overrides the team-configured default', async () => {
      prisma.team.findUnique.mockResolvedValue(CYCLES_TEAM);
      prisma.cycle.findFirst.mockResolvedValue(null);
      prisma.cycle.findMany.mockResolvedValue([]);
      prisma.cycle.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...TEST_CYCLE, ...data }),
      );

      const result = await service.autoCreateUpcomingCycles(TEST_ORG.id, TEST_TEAM.id, 2);

      expect(result).toHaveLength(2);
    });

    it('returns no cycles when the team does not have cycles enabled', async () => {
      prisma.team.findUnique.mockResolvedValue({ ...CYCLES_TEAM, cyclesEnabled: false });

      const result = await service.autoCreateUpcomingCycles(TEST_ORG.id, TEST_TEAM.id);

      expect(result).toEqual([]);
    });
  });
});
