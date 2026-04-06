import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG, TEST_TEAM, TEST_USER } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import { TeamKeyInvalidError, TeamService } from './team.service';

describe('TeamService', () => {
  let prisma: MockPrismaClient;
  let service: TeamService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TeamService(prisma as never);
  });

  describe('create', () => {
    it('creates a team with default workflow states and adds creator as owner', async () => {
      prisma.team.create.mockResolvedValue(TEST_TEAM);
      prisma.teamMembership.create.mockResolvedValue({
        id: 'tm-1',
        isOwner: true,
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      prisma.workflowState.create.mockResolvedValue({});

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        key: 'ENG',
        name: 'Engineering',
      });

      expect(result).toEqual(TEST_TEAM);
      expect(prisma.team.create).toHaveBeenCalledOnce();
      // 5 default workflow states
      expect(prisma.workflowState.create).toHaveBeenCalledTimes(5);
      // Creator added as owner
      expect(prisma.teamMembership.create).toHaveBeenCalledWith({
        data: { isOwner: true, teamId: TEST_TEAM.id, userId: TEST_USER.id },
      });
    });

    it('creates 6 workflow states when triageEnabled is true', async () => {
      prisma.team.create.mockResolvedValue({
        ...TEST_TEAM,
        triageEnabled: true,
      });
      prisma.teamMembership.create.mockResolvedValue({});
      prisma.workflowState.create.mockResolvedValue({});

      await service.create(TEST_ORG.id, TEST_USER.id, {
        key: 'ENG',
        name: 'Engineering',
        triageEnabled: true,
      });

      expect(prisma.workflowState.create).toHaveBeenCalledTimes(6);
      // First state should be triage
      const firstCall = prisma.workflowState.create.mock.calls[0][0];
      expect(firstCall.data.type).toBe('triage');
      expect(firstCall.data.position).toBe(0);
    });

    it('throws TeamKeyInvalidError for lowercase key', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          key: 'eng',
          name: 'Engineering',
        }),
      ).rejects.toThrow(TeamKeyInvalidError);
    });

    it('throws TeamKeyInvalidError for key longer than 10 chars', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          key: 'ENGINEERING',
          name: 'Engineering',
        }),
      ).rejects.toThrow(TeamKeyInvalidError);
    });

    it('throws TeamKeyInvalidError for empty key', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          key: '',
          name: 'Engineering',
        }),
      ).rejects.toThrow(TeamKeyInvalidError);
    });

    it('throws TeamKeyInvalidError for key with numbers', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          key: 'ENG1',
          name: 'Engineering',
        }),
      ).rejects.toThrow(TeamKeyInvalidError);
    });
  });

  describe('findById', () => {
    it('returns team when found', async () => {
      prisma.team.findUnique.mockResolvedValue(TEST_TEAM);
      const result = await service.findById(TEST_TEAM.id);
      expect(result).toEqual(TEST_TEAM);
    });

    it('returns null when not found', async () => {
      prisma.team.findUnique.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByOrgId', () => {
    it('returns teams for organization excluding archived', async () => {
      prisma.team.findMany.mockResolvedValue([TEST_TEAM]);
      const result = await service.findByOrgId(TEST_ORG.id);
      expect(result).toEqual([TEST_TEAM]);
      expect(prisma.team.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
        where: { archivedAt: null, organizationId: TEST_ORG.id },
      });
    });
  });

  describe('update', () => {
    it('updates team fields', async () => {
      const updated = {
        ...TEST_TEAM,
        description: 'Updated',
        name: 'New Name',
      };
      prisma.team.update.mockResolvedValue(updated);

      const result = await service.update(TEST_TEAM.id, {
        description: 'Updated',
        name: 'New Name',
      });

      expect(result).toEqual(updated);
    });
  });

  describe('delete', () => {
    it('soft-deletes a team by setting archivedAt', async () => {
      const archived = { ...TEST_TEAM, archivedAt: new Date() };
      prisma.team.update.mockResolvedValue(archived);

      const result = await service.delete(TEST_TEAM.id);
      expect(result.archivedAt).not.toBeNull();
      expect(prisma.team.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_TEAM.id },
      });
    });
  });

  describe('addMember', () => {
    it('creates a team membership', async () => {
      const membership = {
        id: 'tm-1',
        isOwner: false,
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      };
      prisma.teamMembership.create.mockResolvedValue(membership);

      const result = await service.addMember(TEST_TEAM.id, TEST_USER.id);
      expect(result).toEqual(membership);
    });

    it('creates an owner membership when specified', async () => {
      const membership = {
        id: 'tm-1',
        isOwner: true,
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      };
      prisma.teamMembership.create.mockResolvedValue(membership);

      await service.addMember(TEST_TEAM.id, TEST_USER.id, true);
      expect(prisma.teamMembership.create).toHaveBeenCalledWith({
        data: { isOwner: true, teamId: TEST_TEAM.id, userId: TEST_USER.id },
      });
    });
  });

  describe('removeMember', () => {
    it('deletes the team membership', async () => {
      prisma.teamMembership.delete.mockResolvedValue({ id: 'tm-1' });
      await service.removeMember('tm-1');
      expect(prisma.teamMembership.delete).toHaveBeenCalledWith({
        where: { id: 'tm-1' },
      });
    });
  });
});
