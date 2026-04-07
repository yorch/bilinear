import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORKFLOW_STATES, TEST_TEAM } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import {
  InvalidStateTypeError,
  LastRequiredStateError,
  WorkflowStateService,
} from './workflow-state.service';

describe('WorkflowStateService', () => {
  let prisma: MockPrismaClient;
  let service: WorkflowStateService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new WorkflowStateService(prisma as never);
  });

  describe('create', () => {
    it('creates a workflow state with valid type', async () => {
      const state = DEFAULT_WORKFLOW_STATES[0];
      prisma.workflowState.create.mockResolvedValue(state);

      const result = await service.create({
        color: '#bec2c8',
        name: 'Backlog',
        teamId: TEST_TEAM.id,
        type: 'backlog',
      });

      expect(result).toEqual(state);
      expect(prisma.workflowState.create).toHaveBeenCalledWith({
        data: {
          color: '#bec2c8',
          description: undefined,
          id: undefined,
          name: 'Backlog',
          position: 0,
          teamId: TEST_TEAM.id,
          type: 'backlog',
        },
      });
    });

    it('throws InvalidStateTypeError for invalid type', async () => {
      await expect(
        service.create({
          color: '#000',
          name: 'Bad',
          teamId: TEST_TEAM.id,
          type: 'invalid',
        }),
      ).rejects.toThrow(InvalidStateTypeError);
    });

    it('accepts all valid state types', async () => {
      const validTypes = [
        'triage',
        'backlog',
        'unstarted',
        'started',
        'completed',
        'canceled',
      ];

      for (const type of validTypes) {
        prisma.workflowState.create.mockResolvedValue({
          ...DEFAULT_WORKFLOW_STATES[0],
          type,
        });

        await expect(
          service.create({
            color: '#000',
            name: 'Test',
            teamId: TEST_TEAM.id,
            type,
          }),
        ).resolves.toBeDefined();
      }
    });
  });

  describe('findByTeamId', () => {
    it('returns active states ordered by position', async () => {
      prisma.workflowState.findMany.mockResolvedValue(DEFAULT_WORKFLOW_STATES);

      const result = await service.findByTeamId(TEST_TEAM.id);
      expect(result).toEqual(DEFAULT_WORKFLOW_STATES);
      expect(prisma.workflowState.findMany).toHaveBeenCalledWith({
        orderBy: { position: 'asc' },
        where: { archivedAt: null, teamId: TEST_TEAM.id },
      });
    });
  });

  describe('update', () => {
    it('updates name, color, position, and description', async () => {
      const updated = {
        ...DEFAULT_WORKFLOW_STATES[0],
        color: '#ff0000',
        name: 'Updated',
      };
      prisma.workflowState.update.mockResolvedValue(updated);

      const result = await service.update(DEFAULT_WORKFLOW_STATES[0].id, {
        color: '#ff0000',
        name: 'Updated',
      });

      expect(result).toEqual(updated);
    });
  });

  describe('archive', () => {
    it('archives a non-required state type', async () => {
      const backlogState = DEFAULT_WORKFLOW_STATES[0]; // backlog type
      prisma.workflowState.update.mockResolvedValue({
        ...backlogState,
        archivedAt: new Date(),
      });

      const result = await service.archive(backlogState);
      expect(result.archivedAt).not.toBeNull();
    });

    it('archives a completed state when another completed state exists', async () => {
      const completedState = DEFAULT_WORKFLOW_STATES[3]; // completed type
      prisma.workflowState.count.mockResolvedValue(1); // one other completed state exists
      prisma.workflowState.update.mockResolvedValue({
        ...completedState,
        archivedAt: new Date(),
      });

      const result = await service.archive(completedState);
      expect(result.archivedAt).not.toBeNull();
    });

    it('throws LastRequiredStateError when archiving the only completed state', async () => {
      const completedState = DEFAULT_WORKFLOW_STATES[3];
      prisma.workflowState.count.mockResolvedValue(0); // no other completed states

      await expect(service.archive(completedState)).rejects.toThrow(
        LastRequiredStateError,
      );
    });

    it('throws LastRequiredStateError when archiving the only canceled state', async () => {
      const canceledState = DEFAULT_WORKFLOW_STATES[4];
      prisma.workflowState.count.mockResolvedValue(0);

      await expect(service.archive(canceledState)).rejects.toThrow(
        LastRequiredStateError,
      );
    });
  });
});
