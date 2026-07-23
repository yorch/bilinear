import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_TEAM, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { ProjectService, ProjectValidationError } from './project.service';

const TEST_PROJECT = {
  archivedAt: null,
  color: '#6366f1',
  createdAt: new Date('2026-03-01T00:00:00Z'),
  creatorId: TEST_USER.id,
  description: '',
  health: null,
  id: '00000000-0000-0000-0000-000000000800',
  name: 'Apollo',
  organizationId: TEST_ORG.id,
  slugId: 'apollo',
  statusType: 'planned',
  trashed: false,
};

describe('ProjectService', () => {
  let prisma: MockPrismaClient;
  let service: ProjectService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ProjectService(prisma as never);
  });

  describe('create', () => {
    it('creates a project with defaults, teams, and members', async () => {
      // No existing slug collision.
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.project.create.mockResolvedValue(TEST_PROJECT);
      prisma.projectTeam.createMany.mockResolvedValue({ count: 1 });
      prisma.projectMember.createMany.mockResolvedValue({ count: 1 });

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        memberIds: [TEST_USER.id],
        name: 'Apollo',
        teamIds: [TEST_TEAM.id],
      });

      expect(result).toEqual(TEST_PROJECT);
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          color: '#6366f1',
          creatorId: TEST_USER.id,
          name: 'Apollo',
          organizationId: TEST_ORG.id,
          slugId: 'apollo',
          statusType: 'planned',
        }),
      });
      expect(prisma.projectTeam.createMany).toHaveBeenCalledWith({
        data: [{ projectId: TEST_PROJECT.id, teamId: TEST_TEAM.id }],
        skipDuplicates: true,
      });
      expect(prisma.projectMember.createMany).toHaveBeenCalledWith({
        data: [{ projectId: TEST_PROJECT.id, userId: TEST_USER.id }],
        skipDuplicates: true,
      });
    });

    it('skips team/member inserts when none are provided', async () => {
      prisma.project.findFirst.mockResolvedValue(null);
      prisma.project.create.mockResolvedValue(TEST_PROJECT);

      await service.create(TEST_ORG.id, TEST_USER.id, { name: 'Apollo', teamIds: [] });

      expect(prisma.projectTeam.createMany).not.toHaveBeenCalled();
      expect(prisma.projectMember.createMany).not.toHaveBeenCalled();
    });

    it('slugifies the name and appends a suffix on collision', async () => {
      // First lookup (base slug) collides, second (suffixed) is free.
      prisma.project.findFirst.mockResolvedValueOnce(TEST_PROJECT).mockResolvedValueOnce(null);
      prisma.project.create.mockResolvedValue(TEST_PROJECT);

      await service.create(TEST_ORG.id, TEST_USER.id, {
        name: 'My Cool Project!',
        teamIds: [],
      });

      const slug = prisma.project.create.mock.calls[0][0].data.slugId as string;
      expect(slug).toMatch(/^my-cool-project-[a-z0-9]{4}$/);
    });

    it('rejects a description over the length cap', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          description: 'a'.repeat(100_001),
          name: 'Apollo',
          teamIds: [],
        }),
      ).rejects.toThrow(ProjectValidationError);
      expect(prisma.project.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('only sets provided fields', async () => {
      prisma.project.update.mockResolvedValue({ ...TEST_PROJECT, name: 'Renamed' });

      await service.update(TEST_PROJECT.id, { name: 'Renamed' });

      expect(prisma.project.update).toHaveBeenCalledWith({
        data: { name: 'Renamed' },
        where: { id: TEST_PROJECT.id },
      });
    });

    it('stamps startedAt/completedAt/canceledAt from statusType transitions', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      await service.update(TEST_PROJECT.id, { statusType: 'inProgress' });
      expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({
        startedAt: expect.any(Date),
        statusType: 'inProgress',
      });

      await service.update(TEST_PROJECT.id, { statusType: 'completed' });
      expect(prisma.project.update.mock.calls[1][0].data).toMatchObject({
        completedAt: expect.any(Date),
      });

      await service.update(TEST_PROJECT.id, { statusType: 'canceled' });
      expect(prisma.project.update.mock.calls[2][0].data).toMatchObject({
        canceledAt: expect.any(Date),
      });
    });

    it('clears stale terminal timestamps when reverting statusType (e.g. completed → inProgress)', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);
      // No prior startedAt on record — first entry into inProgress.
      prisma.project.findUnique.mockResolvedValue(null);

      await service.update(TEST_PROJECT.id, { statusType: 'inProgress' });

      // Reverting out of 'completed' must clear the stale completedAt (and
      // canceledAt) that a prior transition may have left behind — before
      // this fix, only the entered status's own timestamp was stamped and
      // the others were left untouched.
      expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({
        canceledAt: null,
        completedAt: null,
        startedAt: expect.any(Date),
      });
    });

    it('clears completedAt when a project is un-paused back to backlog', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      await service.update(TEST_PROJECT.id, { statusType: 'backlog' });

      expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({
        canceledAt: null,
        completedAt: null,
        startedAt: null,
        statusType: 'backlog',
      });
    });

    it('does not re-stamp startedAt when a project already has one (paused → inProgress resume)', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);
      const originalStartedAt = new Date('2026-03-01T00:00:00Z');
      prisma.project.findUnique.mockResolvedValue({ startedAt: originalStartedAt });

      await service.update(TEST_PROJECT.id, { statusType: 'inProgress' });

      const call = prisma.project.update.mock.calls[0][0];
      expect(call.data.startedAt).toBeUndefined();
      // completedAt/canceledAt are still cleared even though startedAt itself
      // isn't re-stamped.
      expect(call.data.completedAt).toBeNull();
      expect(call.data.canceledAt).toBeNull();
    });

    it('stamps healthUpdatedAt when health changes', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      await service.update(TEST_PROJECT.id, { health: 'atRisk' });

      expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({
        health: 'atRisk',
        healthUpdatedAt: expect.any(Date),
      });
    });

    it('nullable date fields are cleared when explicitly set to null', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      await service.update(TEST_PROJECT.id, { startDate: null, targetDate: null });

      expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({
        startDate: null,
        targetDate: null,
      });
    });

    it('rejects a description over the length cap', async () => {
      await expect(
        service.update(TEST_PROJECT.id, { description: 'a'.repeat(100_001) }),
      ).rejects.toThrow(ProjectValidationError);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });

  describe('archive / delete', () => {
    it('archive sets archivedAt', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);
      await service.archive(TEST_PROJECT.id);
      expect(prisma.project.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_PROJECT.id },
      });
    });

    it('delete sets archivedAt and trashed', async () => {
      prisma.project.update.mockResolvedValue(TEST_PROJECT);
      await service.delete(TEST_PROJECT.id);
      expect(prisma.project.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date), trashed: true },
        where: { id: TEST_PROJECT.id },
      });
    });
  });

  describe('getProgress', () => {
    it('returns the completed ratio and scope', async () => {
      prisma.issue.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4);

      const result = await service.getProgress(TEST_PROJECT.id);

      expect(result).toEqual({ progress: 0.4, scope: 10 });
    });

    it('returns zero progress when there are no issues', async () => {
      prisma.issue.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.getProgress(TEST_PROJECT.id);

      expect(result).toEqual({ progress: 0, scope: 0 });
    });
  });

  describe('getProgressBatch', () => {
    // `groupBy` isn't part of the shared mock model (see
    // src/test/prisma-mock.ts) — added ad hoc here rather than widening the
    // shared mock shape, matching the pattern used by
    // initiative.service.test.ts before this logic moved here.
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

    it('computes per-project progress from two batched groupBy queries', async () => {
      issueGroupBy
        .mockResolvedValueOnce([
          { _count: 2, projectId: 'p1' },
          { _count: 2, projectId: 'p2' },
        ])
        .mockResolvedValueOnce([
          { _count: 1, projectId: 'p1' },
          { _count: 2, projectId: 'p2' },
        ]);

      const result = await service.getProgressBatch(['p1', 'p2']);

      expect(result).toEqual(
        new Map([
          ['p1', { progress: 0.5, scope: 2 }],
          ['p2', { progress: 1, scope: 2 }],
        ]),
      );
      expect(issueGroupBy).toHaveBeenCalledTimes(2);
      expect(issueGroupBy).toHaveBeenNthCalledWith(1, {
        _count: true,
        by: ['projectId'],
        where: { archivedAt: null, projectId: { in: ['p1', 'p2'] }, trashed: false },
      });
      expect(issueGroupBy).toHaveBeenNthCalledWith(2, {
        _count: true,
        by: ['projectId'],
        where: {
          archivedAt: null,
          completedAt: { not: null },
          projectId: { in: ['p1', 'p2'] },
          trashed: false,
        },
      });
    });

    it('gives a requested project with no matching issues an explicit zero entry', async () => {
      issueGroupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.getProgressBatch(['p-empty']);

      expect(result).toEqual(new Map([['p-empty', { progress: 0, scope: 0 }]]));
    });
  });

  describe('recordProgressSnapshotIfStale', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('short-circuits without a write when today is already stamped', async () => {
      prisma.project.findUnique.mockResolvedValue({
        completedIssueCountHistory: [],
        completedScopeHistory: [],
        issueCountHistory: [{ t: '2026-06-15', v: 3 }],
        scopeHistory: [],
      });

      const result = await service.recordProgressSnapshotIfStale(TEST_PROJECT.id);

      expect(prisma.issue.count).not.toHaveBeenCalled();
      expect(prisma.project.update).not.toHaveBeenCalled();
      expect(result.issueCountHistory).toEqual([{ t: '2026-06-15', v: 3 }]);
    });

    it('appends a new daily snapshot and persists it', async () => {
      prisma.project.findUnique.mockResolvedValue({
        completedIssueCountHistory: [{ t: '2026-06-14', v: 1 }],
        completedScopeHistory: [],
        issueCountHistory: [{ t: '2026-06-14', v: 5 }],
        scopeHistory: [],
      });
      prisma.issue.count.mockResolvedValueOnce(8).mockResolvedValueOnce(3);
      prisma.issue.aggregate
        .mockResolvedValueOnce({ _sum: { estimate: 20 } })
        .mockResolvedValueOnce({ _sum: { estimate: 9 } });
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      const result = await service.recordProgressSnapshotIfStale(TEST_PROJECT.id);

      expect(result.issueCountHistory).toEqual([
        { t: '2026-06-14', v: 5 },
        { t: '2026-06-15', v: 8 },
      ]);
      expect(result.completedScopeHistory).toEqual([{ t: '2026-06-15', v: 9 }]);
      expect(prisma.project.update).toHaveBeenCalledTimes(1);
    });

    it('treats a null estimate aggregate as zero scope', async () => {
      prisma.project.findUnique.mockResolvedValue({
        completedIssueCountHistory: [],
        completedScopeHistory: [],
        issueCountHistory: [],
        scopeHistory: [],
      });
      prisma.issue.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
      prisma.issue.aggregate
        .mockResolvedValueOnce({ _sum: { estimate: null } })
        .mockResolvedValueOnce({ _sum: { estimate: null } });
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      const result = await service.recordProgressSnapshotIfStale(TEST_PROJECT.id);

      expect(result.scopeHistory).toEqual([{ t: '2026-06-15', v: 0 }]);
    });
  });

  describe('milestones', () => {
    it('creates a milestone with defaults', async () => {
      const milestone = { id: 'm1', name: 'Beta', projectId: TEST_PROJECT.id, sortOrder: 0 };
      prisma.projectMilestone.create.mockResolvedValue(milestone);

      await service.createMilestone({ name: 'Beta', projectId: TEST_PROJECT.id });

      expect(prisma.projectMilestone.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Beta', projectId: TEST_PROJECT.id, sortOrder: 0 }),
      });
    });

    it('soft-deletes a milestone', async () => {
      prisma.projectMilestone.update.mockResolvedValue({ id: 'm1' });

      await service.deleteMilestone('m1');

      expect(prisma.projectMilestone.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: 'm1' },
      });
    });
  });

  describe('project updates', () => {
    it('creates a project update and syncs project health', async () => {
      const update = { health: 'onTrack', id: 'u1', projectId: TEST_PROJECT.id };
      prisma.projectUpdate.create.mockResolvedValue(update);
      prisma.project.update.mockResolvedValue(TEST_PROJECT);

      const result = await service.createProjectUpdate({
        body: 'Looking good',
        bodyData: {},
        health: 'onTrack',
        projectId: TEST_PROJECT.id,
        userId: TEST_USER.id,
      });

      expect(result).toEqual(update);
      expect(prisma.project.update).toHaveBeenCalledWith({
        data: { health: 'onTrack', healthUpdatedAt: expect.any(Date) },
        where: { id: TEST_PROJECT.id },
      });
    });

    it('stamps editedAt on update', async () => {
      prisma.projectUpdate.update.mockResolvedValue({ id: 'u1' });

      await service.updateProjectUpdate('u1', { body: 'Revised' });

      expect(prisma.projectUpdate.update.mock.calls[0][0].data).toMatchObject({
        body: 'Revised',
        editedAt: expect.any(Date),
      });
    });
  });

  describe('team / member associations', () => {
    it('getTeams unwraps the join rows', async () => {
      prisma.projectTeam.findMany.mockResolvedValue([{ team: TEST_TEAM }]);

      const result = await service.getTeams(TEST_PROJECT.id);

      expect(result).toEqual([TEST_TEAM]);
    });

    it('removeMember deletes the join row', async () => {
      prisma.projectMember.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeMember(TEST_PROJECT.id, TEST_USER.id);

      expect(prisma.projectMember.deleteMany).toHaveBeenCalledWith({
        where: { projectId: TEST_PROJECT.id, userId: TEST_USER.id },
      });
    });
  });
});
