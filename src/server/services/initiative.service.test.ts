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
    beforeEach(() => {
      // update() now uses updateMany scoped by orgId, then findUnique to
      // re-read the row. Provide defaults so tests focused on the data
      // patch don't have to re-state the plumbing.
      prisma.initiative.updateMany.mockResolvedValue({ count: 1 });
      prisma.initiative.findUnique.mockResolvedValue(TEST_INITIATIVE);
      // Default "current" snapshot for the active-transition guard.
      prisma.initiative.findFirst.mockResolvedValue({
        startedAt: null,
        status: 'planned',
      });
    });

    it('stamps startedAt when transitioning planned → active', async () => {
      await service.update(TEST_ORG.id, TEST_INITIATIVE.id, { status: 'active' });

      expect(prisma.initiative.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt: expect.any(Date),
          status: 'active',
        }),
        where: { id: TEST_INITIATIVE.id, organizationId: TEST_ORG.id },
      });
    });

    it('preserves the original startedAt on active → active no-op', async () => {
      const originalStartedAt = new Date('2026-03-01T00:00:00Z');
      prisma.initiative.findFirst.mockResolvedValue({
        startedAt: originalStartedAt,
        status: 'active',
      });

      await service.update(TEST_ORG.id, TEST_INITIATIVE.id, { status: 'active' });

      const call = prisma.initiative.updateMany.mock.calls[0][0];
      // startedAt should NOT be re-stamped — the original "started" time
      // is preserved across no-op edits.
      expect(call.data.startedAt).toBeUndefined();
    });

    it('clears terminal timestamps when reverting to planned', async () => {
      await service.update(TEST_ORG.id, TEST_INITIATIVE.id, { status: 'planned' });

      expect(prisma.initiative.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          completedAt: null,
          startedAt: null,
          status: 'planned',
        }),
        where: { id: TEST_INITIATIVE.id, organizationId: TEST_ORG.id },
      });
    });

    it('throws NotFound when the initiative belongs to a different org', async () => {
      prisma.initiative.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update(TEST_ORG.id, TEST_INITIATIVE.id, { name: 'New name' }),
      ).rejects.toThrow('Initiative not found');
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
      // Tenant checks: both initiative and project must exist in orgId.
      prisma.initiative.findFirst.mockResolvedValue({ id: TEST_INITIATIVE.id });
      prisma.project.findFirst.mockResolvedValue({ id: 'p-1' });
      prisma.initiativeProject.upsert.mockResolvedValue({
        id: 'link-1',
        initiativeId: TEST_INITIATIVE.id,
        projectId: 'p-1',
      });

      const result = await service.addProject(TEST_ORG.id, TEST_INITIATIVE.id, 'p-1');

      expect(result).toMatchObject({ id: 'link-1' });
      expect(prisma.initiativeProject.upsert).toHaveBeenCalledWith({
        create: { initiativeId: TEST_INITIATIVE.id, projectId: 'p-1' },
        update: {},
        where: {
          initiativeId_projectId: { initiativeId: TEST_INITIATIVE.id, projectId: 'p-1' },
        },
      });
      // Recompute is now the caller's responsibility (cascade form, so
      // ancestor SyncActions are emitted). addProject itself doesn't
      // touch `prisma.initiative.update` anymore.
      expect(prisma.initiative.update).not.toHaveBeenCalled();
    });

    it('refuses when the project belongs to a different org', async () => {
      prisma.initiative.findFirst.mockResolvedValue({ id: TEST_INITIATIVE.id });
      prisma.project.findFirst.mockResolvedValue(null);

      await expect(
        service.addProject(TEST_ORG.id, TEST_INITIATIVE.id, 'p-foreign'),
      ).rejects.toThrow('One or more projects not found');
      expect(prisma.initiativeProject.upsert).not.toHaveBeenCalled();
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
    beforeEach(() => {
      prisma.initiative.updateMany.mockResolvedValue({ count: 1 });
      prisma.initiative.findUnique.mockResolvedValue(TEST_INITIATIVE);
    });

    it('clears canceledAt when transitioning canceled → active', async () => {
      prisma.initiative.findFirst.mockResolvedValue({ startedAt: null, status: 'canceled' });

      await service.update(TEST_ORG.id, TEST_INITIATIVE.id, { status: 'active' });

      expect(prisma.initiative.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          completedAt: null,
          startedAt: expect.any(Date),
          status: 'active',
        }),
        where: { id: TEST_INITIATIVE.id, organizationId: TEST_ORG.id },
      });
    });

    it('clears completedAt when transitioning completed → active', async () => {
      prisma.initiative.findFirst.mockResolvedValue({ startedAt: null, status: 'completed' });

      await service.update(TEST_ORG.id, TEST_INITIATIVE.id, { status: 'active' });

      // Both terminal markers cleared, startedAt stamped fresh (no prior
      // active session to preserve).
      expect(prisma.initiative.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: null,
          completedAt: null,
          startedAt: expect.any(Date),
          status: 'active',
        }),
        where: { id: TEST_INITIATIVE.id, organizationId: TEST_ORG.id },
      });
    });

    it('clears completedAt when transitioning completed → canceled', async () => {
      await service.update(TEST_ORG.id, TEST_INITIATIVE.id, { status: 'canceled' });

      expect(prisma.initiative.updateMany).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canceledAt: expect.any(Date),
          completedAt: null,
          status: 'canceled',
        }),
        where: { id: TEST_INITIATIVE.id, organizationId: TEST_ORG.id },
      });
    });
  });

  describe('initiative updates (status reports)', () => {
    const TEST_UPDATE = {
      archivedAt: null,
      body: 'Q2 is on track',
      bodyData: {},
      createdAt: new Date('2026-05-18T00:00:00Z'),
      editedAt: null,
      health: 'onTrack',
      id: '00000000-0000-0000-0000-000000000a01',
      initiativeId: TEST_INITIATIVE.id,
      updatedAt: new Date('2026-05-18T00:00:00Z'),
      userId: TEST_USER.id,
    };

    describe('createInitiativeUpdate', () => {
      it('persists body, bodyData, and health under the initiative', async () => {
        prisma.initiativeUpdate.create.mockResolvedValue(TEST_UPDATE);

        const result = await service.createInitiativeUpdate({
          body: 'Q2 is on track',
          bodyData: {},
          health: 'onTrack',
          initiativeId: TEST_INITIATIVE.id,
          userId: TEST_USER.id,
        });

        expect(prisma.initiativeUpdate.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            body: 'Q2 is on track',
            health: 'onTrack',
            initiativeId: TEST_INITIATIVE.id,
            userId: TEST_USER.id,
          }),
        });
        expect(result).toEqual(TEST_UPDATE);
      });
    });

    describe('updateInitiativeUpdate', () => {
      it('stamps editedAt and only writes provided fields', async () => {
        prisma.initiativeUpdate.update.mockResolvedValue({ ...TEST_UPDATE, body: 'Updated' });

        await service.updateInitiativeUpdate(TEST_UPDATE.id, { body: 'Updated' });

        const call = prisma.initiativeUpdate.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: TEST_UPDATE.id });
        expect(call.data.body).toBe('Updated');
        expect(call.data.editedAt).toBeInstanceOf(Date);
        // bodyData / health weren't passed — should not be in the data payload
        expect(call.data.bodyData).toBeUndefined();
        expect(call.data.health).toBeUndefined();
      });
    });

    describe('deleteInitiativeUpdate', () => {
      it('soft-deletes by stamping archivedAt (not a hard delete)', async () => {
        prisma.initiativeUpdate.update.mockResolvedValue({
          ...TEST_UPDATE,
          archivedAt: new Date(),
        });

        await service.deleteInitiativeUpdate(TEST_UPDATE.id);

        const call = prisma.initiativeUpdate.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: TEST_UPDATE.id });
        expect(call.data.archivedAt).toBeInstanceOf(Date);
      });
    });

    describe('getInitiativeUpdates', () => {
      it('returns non-archived updates newest-first', async () => {
        prisma.initiativeUpdate.findMany.mockResolvedValue([TEST_UPDATE]);

        await service.getInitiativeUpdates(TEST_INITIATIVE.id);

        expect(prisma.initiativeUpdate.findMany).toHaveBeenCalledWith({
          orderBy: { createdAt: 'desc' },
          where: { archivedAt: null, initiativeId: TEST_INITIATIVE.id },
        });
      });
    });
  });
});
