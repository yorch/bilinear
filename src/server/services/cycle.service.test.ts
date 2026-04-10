import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG, TEST_TEAM } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import {
  CycleInvalidDatesError,
  CycleOverlapError,
  CycleService,
} from './cycle.service';

const TEST_CYCLE = {
  archivedAt: null,
  completedAt: null,
  completedIssueCountHistory: [],
  completedScopeHistory: [],
  createdAt: new Date('2026-03-01T00:00:00Z'),
  description: null,
  endsAt: new Date('2026-03-15T00:00:00Z'),
  id: '00000000-0000-0000-0000-000000000600',
  issueCountHistory: [],
  name: 'Sprint 1',
  number: 1,
  organizationId: '00000000-0000-0000-0000-000000000001',
  progress: 0,
  scope: 0,
  scopeHistory: [],
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
    it('unassigns issues and deletes cycle', async () => {
      prisma.issue.updateMany.mockResolvedValue({ count: 2 });
      prisma.cycle.delete.mockResolvedValue(TEST_CYCLE);

      await service.delete(TEST_CYCLE.id);

      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: { cycleId: null },
        where: { cycleId: TEST_CYCLE.id },
      });
      expect(prisma.cycle.delete).toHaveBeenCalledWith({
        where: { id: TEST_CYCLE.id },
      });
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

      await service.addIssueToCycle(TEST_CYCLE.id, issueId);

      expect(prisma.issue.update).toHaveBeenCalledWith({
        data: { addedToCycleAt: expect.any(Date), cycleId: TEST_CYCLE.id },
        where: { id: issueId },
      });
    });
  });
});
