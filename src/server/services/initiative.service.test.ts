import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  InitiativeInvalidStatusError,
  InitiativeProjectNotFoundError,
  InitiativeService,
} from './initiative.service';

const TEST_INITIATIVE = {
  archivedAt: null,
  canceledAt: null,
  color: '#6366f1',
  completedAt: null,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  creatorId: TEST_USER.id,
  description: null,
  icon: null,
  id: '00000000-0000-0000-0000-000000000900',
  name: 'Q2 Goals',
  organizationId: TEST_ORG.id,
  ownerId: null,
  priority: 0,
  prioritySortOrder: 0,
  progress: 0,
  sortOrder: 0,
  startDate: null,
  startDateResolution: null,
  startedAt: null,
  status: 'planned',
  targetDate: null,
  targetDateResolution: null,
  updatedAt: new Date('2026-04-01T00:00:00Z'),
};

describe('InitiativeService', () => {
  let prisma: MockPrismaClient;
  let service: InitiativeService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new InitiativeService(prisma as never);
  });

  describe('create', () => {
    it('creates an initiative with default status', async () => {
      prisma.initiative.create.mockResolvedValue(TEST_INITIATIVE);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        name: 'Q2 Goals',
      });

      expect(result).toEqual(TEST_INITIATIVE);
      expect(prisma.initiative.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            color: '#6366f1',
            creatorId: TEST_USER.id,
            name: 'Q2 Goals',
            organizationId: TEST_ORG.id,
            status: 'planned',
          }),
        }),
      );
    });

    it('rejects invalid status', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          name: 'Q2',
          // Bypass the typed input — the service validates at runtime so
          // we can still defend against callers that come in untyped (e.g.
          // GraphQL input that wasn't enum-validated).
          status: 'invalid' as never,
        }),
      ).rejects.toThrow(InitiativeInvalidStatusError);
    });

    it('rejects projectIds with mismatched org', async () => {
      prisma.initiative.create.mockResolvedValue(TEST_INITIATIVE);
      prisma.project.findMany.mockResolvedValue([]); // none belong to org

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          name: 'Q2',
          projectIds: ['project-x'],
        }),
      ).rejects.toThrow(InitiativeProjectNotFoundError);
    });

    it('links projects on creation', async () => {
      prisma.initiative.create.mockResolvedValue(TEST_INITIATIVE);
      prisma.project.findMany.mockResolvedValue([{ id: 'project-x' }]);

      await service.create(TEST_ORG.id, TEST_USER.id, {
        name: 'Q2',
        projectIds: ['project-x'],
      });

      expect(prisma.initiativeProject.createMany).toHaveBeenCalledWith({
        data: [
          {
            initiativeId: TEST_INITIATIVE.id,
            projectId: 'project-x',
            sortOrder: 0,
          },
        ],
        skipDuplicates: true,
      });
    });
  });

  describe('update', () => {
    it('stamps startedAt when transitioning to active', async () => {
      prisma.initiative.update.mockResolvedValue({
        ...TEST_INITIATIVE,
        status: 'active',
      });

      await service.update(TEST_INITIATIVE.id, { status: 'active' });

      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt: expect.any(Date),
          status: 'active',
        }),
        where: { id: TEST_INITIATIVE.id },
      });
    });

    it('clears terminal timestamps when reverting to planned', async () => {
      prisma.initiative.update.mockResolvedValue(TEST_INITIATIVE);

      await service.update(TEST_INITIATIVE.id, { status: 'planned' });

      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          completedAt: null,
          startedAt: null,
          status: 'planned',
        }),
        where: { id: TEST_INITIATIVE.id },
      });
    });
  });

  describe('recomputeProgress', () => {
    it('returns the updated initiative with progress=0 when no projects are linked', async () => {
      prisma.initiativeProject.findMany.mockResolvedValue([]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0.5 });
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, progress: 0 });

      const result = await service.recomputeProgress(TEST_INITIATIVE.id);
      expect(result?.progress).toBe(0);
    });

    it('computes mean of linked project progress', async () => {
      prisma.initiativeProject.findMany.mockResolvedValue([
        { project: { archivedAt: null, progress: 0.5, trashed: false } },
        { project: { archivedAt: null, progress: 1.0, trashed: false } },
      ]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0 });
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, progress: 0.75 });

      const result = await service.recomputeProgress(TEST_INITIATIVE.id);
      expect(result?.progress).toBe(0.75);
      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: { progress: 0.75 },
        where: { id: TEST_INITIATIVE.id },
      });
    });

    it('skips archived/trashed projects', async () => {
      prisma.initiativeProject.findMany.mockResolvedValue([
        { project: { archivedAt: null, progress: 0.5, trashed: false } },
        { project: { archivedAt: new Date(), progress: 1.0, trashed: false } },
        { project: { archivedAt: null, progress: 1.0, trashed: true } },
      ]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0 });
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, progress: 0.5 });

      const result = await service.recomputeProgress(TEST_INITIATIVE.id);
      expect(result?.progress).toBe(0.5);
    });

    it('returns null if the initiative has been deleted', async () => {
      prisma.initiativeProject.findMany.mockResolvedValue([]);
      prisma.initiative.findUnique.mockResolvedValue(null);

      const result = await service.recomputeProgress(TEST_INITIATIVE.id);
      expect(result).toBeNull();
      expect(prisma.initiative.update).not.toHaveBeenCalled();
    });

    it('skips the write (and SyncAction) when progress is unchanged', async () => {
      prisma.initiativeProject.findMany.mockResolvedValue([
        { project: { archivedAt: null, progress: 0.5, trashed: false } },
      ]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0.5 });

      const result = await service.recomputeProgress(TEST_INITIATIVE.id);
      expect(result).toBeNull();
      expect(prisma.initiative.update).not.toHaveBeenCalled();
    });
  });

  describe('addProject', () => {
    it('upserts the link and recomputes progress', async () => {
      prisma.initiativeProject.upsert.mockResolvedValue({
        id: 'link-1',
        initiativeId: TEST_INITIATIVE.id,
        projectId: 'p-1',
      });
      prisma.initiativeProject.findMany.mockResolvedValue([
        { project: { archivedAt: null, progress: 0.4, trashed: false } },
      ]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0 });
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, progress: 0.4 });

      const result = await service.addProject(TEST_INITIATIVE.id, 'p-1');

      expect(result).toMatchObject({ id: 'link-1' });
      expect(prisma.initiativeProject.upsert).toHaveBeenCalledWith({
        create: { initiativeId: TEST_INITIATIVE.id, projectId: 'p-1' },
        update: {},
        where: {
          initiativeId_projectId: { initiativeId: TEST_INITIATIVE.id, projectId: 'p-1' },
        },
      });
      // recompute fired
      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: { progress: 0.4 },
        where: { id: TEST_INITIATIVE.id },
      });
    });
  });

  describe('getInitiativesForProject', () => {
    it('filters out archived initiatives', async () => {
      prisma.initiativeProject.findMany.mockResolvedValue([{ initiative: TEST_INITIATIVE }]);
      const result = await service.getInitiativesForProject('p-1');
      expect(result).toHaveLength(1);
      // The query itself adds the archivedAt: null filter — verify it's
      // present so an archived initiative can't sneak through.
      expect(prisma.initiativeProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            initiative: { archivedAt: null },
            projectId: 'p-1',
          }),
        }),
      );
    });
  });

  describe('removeProject', () => {
    it('returns the deleted link id', async () => {
      prisma.initiativeProject.delete.mockResolvedValue({ id: 'link-123' });
      prisma.initiativeProject.findMany.mockResolvedValue([]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0.5 });
      prisma.initiative.update.mockResolvedValue(TEST_INITIATIVE);

      const result = await service.removeProject('init-1', 'project-1');
      expect(result).toBe('link-123');
    });

    it('returns null and is idempotent when link is already gone', async () => {
      prisma.initiativeProject.delete.mockRejectedValue(new Error('not found'));
      prisma.initiativeProject.findMany.mockResolvedValue([]);
      prisma.initiative.findUnique.mockResolvedValue({ progress: 0 });

      const result = await service.removeProject('init-1', 'project-1');
      expect(result).toBeNull();
    });
  });

  describe('update status transitions', () => {
    it('clears canceledAt when transitioning canceled → active', async () => {
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, status: 'active' });

      await service.update(TEST_INITIATIVE.id, { status: 'active' });

      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          completedAt: null,
          startedAt: expect.any(Date),
          status: 'active',
        }),
        where: { id: TEST_INITIATIVE.id },
      });
    });

    it('clears completedAt when transitioning completed → active', async () => {
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, status: 'active' });

      await service.update(TEST_INITIATIVE.id, { status: 'active' });

      // Both terminal markers cleared, startedAt stamped fresh.
      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          completedAt: null,
          startedAt: expect.any(Date),
          status: 'active',
        }),
        where: { id: TEST_INITIATIVE.id },
      });
    });

    it('clears completedAt when transitioning completed → canceled', async () => {
      prisma.initiative.update.mockResolvedValue({ ...TEST_INITIATIVE, status: 'canceled' });

      await service.update(TEST_INITIATIVE.id, { status: 'canceled' });

      expect(prisma.initiative.update).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: expect.any(Date),
          completedAt: null,
          status: 'canceled',
        }),
        where: { id: TEST_INITIATIVE.id },
      });
    });
  });
});
