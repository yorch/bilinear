import { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { DEFAULT_WORKFLOW_STATES, TEST_TEAM, TEST_TEAM_MEMBERSHIP } from '../../../test/fixtures';
import { workflowStateResolvers } from './workflow-state';

describe('workflowStateResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
    // Default: user is a team member (for auth checks)
    ctx.prisma.teamMembership.findUnique.mockResolvedValue(TEST_TEAM_MEMBERSHIP);
  });

  describe('Mutation.workflowStateCreate', () => {
    it('creates a workflow state when user is team member', async () => {
      const newState = DEFAULT_WORKFLOW_STATES[0];
      ctx.prisma.workflowState.create.mockResolvedValue(newState);

      const result = await workflowStateResolvers.Mutation.workflowStateCreate(
        null,
        {
          input: {
            color: '#bec2c8',
            name: 'Backlog',
            teamId: TEST_TEAM.id,
            type: 'backlog',
          },
        },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.workflowState).toEqual(newState);
    });

    it('throws BAD_USER_INPUT for invalid state type', async () => {
      try {
        await workflowStateResolvers.Mutation.workflowStateCreate(
          null,
          {
            input: {
              color: '#000',
              name: 'Bad',
              teamId: TEST_TEAM.id,
              type: 'invalid_type',
            },
          },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('BAD_USER_INPUT');
      }
    });

    it('throws UNAUTHENTICATED when not logged in', async () => {
      ctx = createMockContext({ userId: null });

      try {
        await workflowStateResolvers.Mutation.workflowStateCreate(
          null,
          {
            input: {
              color: '#000',
              name: 'Test',
              teamId: TEST_TEAM.id,
              type: 'backlog',
            },
          },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('UNAUTHENTICATED');
      }
    });

    it('throws FORBIDDEN when user is not a team member', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      try {
        await workflowStateResolvers.Mutation.workflowStateCreate(
          null,
          {
            input: {
              color: '#000',
              name: 'Test',
              teamId: TEST_TEAM.id,
              type: 'backlog',
            },
          },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('Mutation.workflowStateUpdate', () => {
    it('updates a workflow state when user is team member', async () => {
      const existing = DEFAULT_WORKFLOW_STATES[0];
      const updated = { ...existing, name: 'Updated' };
      ctx.prisma.workflowState.findUnique.mockResolvedValue(existing);
      ctx.prisma.workflowState.update.mockResolvedValue(updated);

      const result = await workflowStateResolvers.Mutation.workflowStateUpdate(
        null,
        {
          id: existing.id,
          input: { name: 'Updated' },
        },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.workflowState.name).toBe('Updated');
    });

    it('throws NOT_FOUND when state does not exist', async () => {
      ctx.prisma.workflowState.findUnique.mockResolvedValue(null);

      try {
        await workflowStateResolvers.Mutation.workflowStateUpdate(
          null,
          { id: 'nonexistent', input: { name: 'Updated' } },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('Mutation.workflowStateArchive', () => {
    it('archives a workflow state when user is team member', async () => {
      const backlogState = DEFAULT_WORKFLOW_STATES[0];
      ctx.prisma.workflowState.findUnique.mockResolvedValue(backlogState);
      ctx.prisma.workflowState.update.mockResolvedValue({
        ...backlogState,
        archivedAt: new Date(),
      });

      const result = await workflowStateResolvers.Mutation.workflowStateArchive(
        null,
        { id: backlogState.id },
        ctx as never,
      );

      expect(result.success).toBe(true);
      expect(result.workflowState.archivedAt).not.toBeNull();
    });

    it('throws NOT_FOUND when state does not exist', async () => {
      ctx.prisma.workflowState.findUnique.mockResolvedValue(null);

      try {
        await workflowStateResolvers.Mutation.workflowStateArchive(
          null,
          { id: 'nonexistent' },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('NOT_FOUND');
      }
    });

    it('throws BAD_USER_INPUT when archiving last completed state', async () => {
      const completedState = DEFAULT_WORKFLOW_STATES[3]; // type: completed
      ctx.prisma.workflowState.findUnique.mockResolvedValue(completedState);
      ctx.prisma.workflowState.count.mockResolvedValue(0);

      try {
        await workflowStateResolvers.Mutation.workflowStateArchive(
          null,
          { id: completedState.id },
          ctx as never,
        );
        expect.unreachable('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(GraphQLError);
        expect((e as GraphQLError).extensions?.code).toBe('BAD_USER_INPUT');
      }
    });
  });

  describe('WorkflowState field resolvers', () => {
    it('resolves team for a workflow state', async () => {
      ctx.prisma.team.findUnique.mockResolvedValue(TEST_TEAM);

      const result = await workflowStateResolvers.WorkflowState.team(
        DEFAULT_WORKFLOW_STATES[0] as never,
        {},
        ctx as never,
      );

      expect(result).toEqual(TEST_TEAM);
    });
  });
});
