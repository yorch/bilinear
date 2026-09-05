import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG, TEST_TEAM, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { TeamKeyInvalidError, TeamService } from './team.service';

describe('TeamService', () => {
  let prisma: MockPrismaClient;
  let service: TeamService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new TeamService(prisma as never);
  });

  describe('create', () => {
    const mockStates = [
      { id: 'ws-backlog', type: 'backlog' },
      { id: 'ws-todo', type: 'unstarted' },
      { id: 'ws-in-progress', type: 'started' },
      { id: 'ws-done', type: 'completed' },
      { id: 'ws-canceled', type: 'canceled' },
    ];

    it('creates a team with default workflow states and adds creator as owner', async () => {
      prisma.team.create.mockResolvedValue(TEST_TEAM);
      prisma.teamMembership.create.mockResolvedValue({
        id: 'tm-1',
        isOwner: true,
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      for (const state of mockStates) {
        prisma.workflowState.create.mockResolvedValueOnce(state);
      }
      prisma.team.update.mockResolvedValue(TEST_TEAM);
      prisma.team.findUnique.mockResolvedValue(TEST_TEAM);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        key: 'ENG',
        name: 'Engineering',
      });

      expect(result.team).toEqual(TEST_TEAM);
      expect(result.states).toHaveLength(5);
      expect(prisma.team.create).toHaveBeenCalledOnce();
      // 5 default workflow states
      expect(prisma.workflowState.create).toHaveBeenCalledTimes(5);
      // Sets backlog as default issue state
      expect(prisma.team.update).toHaveBeenCalledWith({
        data: { defaultIssueStateId: 'ws-backlog' },
        where: { id: TEST_TEAM.id },
      });
      // Creator added as owner
      expect(prisma.teamMembership.create).toHaveBeenCalledWith({
        data: { isOwner: true, teamId: TEST_TEAM.id, userId: TEST_USER.id },
      });
    });

    it('seeds workflow states sequentially inside the transaction', async () => {
      // Prisma's interactive transaction client serialises commands over
      // one connection, so the seed must never have two creates in flight.
      let inFlight = 0;
      let maxInFlight = 0;
      let i = 0;
      prisma.team.create.mockResolvedValue(TEST_TEAM);
      prisma.teamMembership.create.mockResolvedValue({ id: 'tm-1' });
      prisma.workflowState.create.mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return mockStates[i++];
      });
      prisma.team.update.mockResolvedValue(TEST_TEAM);
      prisma.team.findUnique.mockResolvedValue(TEST_TEAM);

      await service.create(TEST_ORG.id, TEST_USER.id, { key: 'ENG', name: 'Engineering' });

      expect(prisma.workflowState.create).toHaveBeenCalledTimes(5);
      expect(maxInFlight).toBe(1);
    });

    it('creates 6 workflow states when triageEnabled is true', async () => {
      prisma.team.create.mockResolvedValue({
        ...TEST_TEAM,
        triageEnabled: true,
      });
      prisma.teamMembership.create.mockResolvedValue({});
      const triageMockStates = [{ id: 'ws-triage', type: 'triage' }, ...mockStates];
      for (const state of triageMockStates) {
        prisma.workflowState.create.mockResolvedValueOnce(state);
      }
      prisma.team.update.mockResolvedValue(TEST_TEAM);
      prisma.team.findUnique.mockResolvedValue(TEST_TEAM);

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
      // Still sets backlog (not triage) as default
      expect(prisma.team.update).toHaveBeenCalledWith({
        data: { defaultIssueStateId: 'ws-backlog' },
        where: { id: TEST_TEAM.id },
      });
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

    it('rejects numeric knobs outside their bounds before touching the database', async () => {
      await expect(service.update(TEST_TEAM.id, { cycleDuration: 0 })).rejects.toThrow(
        /cycleDuration/,
      );
      await expect(service.update(TEST_TEAM.id, { cycleStartDay: 7 })).rejects.toThrow(
        /cycleStartDay/,
      );
      await expect(service.update(TEST_TEAM.id, { cycleCooldownTime: -1 })).rejects.toThrow(
        /cycleCooldownTime/,
      );
      await expect(service.update(TEST_TEAM.id, { autoClosePeriod: 0 })).rejects.toThrow(
        /autoClosePeriod/,
      );
      await expect(service.update(TEST_TEAM.id, { timezone: 'Mars/Olympus' })).rejects.toThrow(
        /timezone/,
      );
      expect(prisma.team.update).not.toHaveBeenCalled();
    });

    it('accepts null to clear an auto period and a valid timezone', async () => {
      prisma.team.update.mockResolvedValue(TEST_TEAM);
      await service.update(TEST_TEAM.id, {
        autoArchivePeriod: null,
        cycleStartDay: 1,
        timezone: 'Europe/Madrid',
      });
      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            autoArchivePeriod: null,
            cycleStartDay: 1,
            timezone: 'Europe/Madrid',
          }),
        }),
      );
    });

    it("refuses a default state that is not one of the team's own", async () => {
      prisma.workflowState.findFirst.mockResolvedValue(null);
      await expect(
        service.update(TEST_TEAM.id, { defaultIssueStateId: 'state-of-other-team' }),
      ).rejects.toThrow(/defaultIssueStateId/);
      expect(prisma.workflowState.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { archivedAt: null, id: 'state-of-other-team', teamId: TEST_TEAM.id },
        }),
      );
      expect(prisma.team.update).not.toHaveBeenCalled();
    });

    it('writes a default state that belongs to the team', async () => {
      prisma.workflowState.findFirst.mockResolvedValue({ id: 'state-1' });
      prisma.team.update.mockResolvedValue(TEST_TEAM);
      await service.update(TEST_TEAM.id, { defaultIssueStateId: 'state-1' });
      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ defaultIssueStateId: 'state-1' }),
        }),
      );
    });
  });

  describe('delete', () => {
    it('soft-deletes a team and archives its issues when issueAction is DELETE', async () => {
      const archived = { ...TEST_TEAM, archivedAt: new Date() };
      prisma.issue.updateMany.mockResolvedValue({ count: 3 });
      prisma.team.update.mockResolvedValue(archived);

      const result = await service.delete(TEST_TEAM.id, {
        issueAction: 'DELETE',
      });
      expect(result.team.archivedAt).not.toBeNull();
      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { archivedAt: null, teamId: TEST_TEAM.id },
      });
    });

    it('throws when issueAction is MOVE but moveToTeamId is missing', async () => {
      await expect(service.delete(TEST_TEAM.id, { issueAction: 'MOVE' })).rejects.toThrow(
        'moveToTeamId is required',
      );
    });

    it('throws when moveToTeamId is the same as the team being deleted', async () => {
      await expect(
        service.delete(TEST_TEAM.id, {
          issueAction: 'MOVE',
          moveToTeamId: TEST_TEAM.id,
        }),
      ).rejects.toThrow('Cannot move issues to the same team');
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
