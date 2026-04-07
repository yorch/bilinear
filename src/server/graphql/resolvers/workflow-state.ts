import { GraphQLError } from 'graphql';
import type { WorkflowState } from '../../../generated/prisma';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type {
  WorkflowStateCreateInput,
  WorkflowStateUpdateInput,
} from '../../services/workflow-state.service';
import type { GraphQLContext } from '../context';

export const workflowStateResolvers = {
  Mutation: {
    workflowStateArchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.workflowState.findById(id);
      if (!existing) {
        throw new GraphQLError('Workflow state not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      try {
        const workflowState =
          await ctx.services.workflowState.archive(existing);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'A',
          'WorkflowState',
          id,
          workflowState,
        );
        return { lastSyncId: sync.id.toString(), success: true, workflowState };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'LastRequiredStateError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    workflowStateCreate: async (
      _parent: unknown,
      { input }: { input: WorkflowStateCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, input.teamId, ctx.userId);

      try {
        const workflowState = await ctx.services.workflowState.create(input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'WorkflowState',
          workflowState.id,
          workflowState,
        );
        return { lastSyncId: sync.id.toString(), success: true, workflowState };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'InvalidStateTypeError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    workflowStateUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: WorkflowStateUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.workflowState.findById(id);
      if (!existing) {
        throw new GraphQLError('Workflow state not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      const workflowState = await ctx.services.workflowState.update(id, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'WorkflowState',
        id,
        workflowState,
      );
      return { lastSyncId: sync.id.toString(), success: true, workflowState };
    },
  },

  WorkflowState: {
    team: async (state: WorkflowState, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.team.findById(state.teamId);
    },
  },
};
