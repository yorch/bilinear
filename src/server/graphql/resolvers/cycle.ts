import { GraphQLError } from 'graphql';
import type { Cycle } from '../../../generated/prisma';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type {
  CycleCreateInput,
  CycleUpdateInput,
} from '../../services/cycle.service';
import type { GraphQLContext } from '../context';

export const cycleResolvers = {
  Cycle: {
    issues: async (cycle: Cycle, _args: unknown, ctx: GraphQLContext) => {
      return ctx.prisma.issue.findMany({
        orderBy: { sortOrder: 'asc' },
        where: { archivedAt: null, cycleId: cycle.id, trashed: false },
      });
    },

    team: async (cycle: Cycle, _args: unknown, ctx: GraphQLContext) => {
      return ctx.services.team.findById(cycle.teamId);
    },
  },

  Mutation: {
    cycleAddIssue: async (
      _parent: unknown,
      { cycleId, issueId }: { cycleId: string; issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const cycle = await ctx.services.cycle.findById(cycleId);
      if (!cycle || cycle.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, cycle.teamId, ctx.userId);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      await ctx.services.cycle.addIssueToCycle(cycleId, issueId);
      const updatedIssue = await ctx.services.issue.findById(issueId);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Issue',
        issueId,
        updatedIssue,
      );
      return {
        issue: updatedIssue,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },

    cycleArchive: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.cycle.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      const cycle = await ctx.services.cycle.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'Cycle',
        id,
        cycle,
      );
      return { cycle, lastSyncId: sync.id.toString(), success: true };
    },

    cycleCreate: async (
      _parent: unknown,
      { input }: { input: CycleCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, input.teamId, ctx.userId);

      // Verify team belongs to user's org
      const team = await ctx.services.team.findById(input.teamId);
      if (!team || team.organizationId !== ctx.orgId) {
        throw new GraphQLError('Team not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      try {
        const cycle = await ctx.services.cycle.create(ctx.orgId, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'Cycle',
          cycle.id,
          cycle,
        );
        return { cycle, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        const error = err as Error;
        if (
          error.name === 'CycleOverlapError' ||
          error.name === 'CycleInvalidDatesError'
        ) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    cycleDelete: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.cycle.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      await ctx.services.cycle.delete(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'Cycle',
        id,
        null,
      );
      return { lastSyncId: sync.id.toString(), success: true };
    },

    cycleRemoveIssue: async (
      _parent: unknown,
      { issueId }: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);

      await ctx.services.cycle.removeIssueFromCycle(issueId);
      const updatedIssue = await ctx.services.issue.findById(issueId);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Issue',
        issueId,
        updatedIssue,
      );
      return {
        issue: updatedIssue,
        lastSyncId: sync.id.toString(),
        success: true,
      };
    },

    cycleRollover: async (
      _parent: unknown,
      {
        cycleId,
        targetCycleId: _targetCycleId,
      }: { cycleId: string; targetCycleId?: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        const result = await ctx.services.cycle.rollover(ctx.orgId, cycleId);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Cycle',
          cycleId,
          { completedAt: new Date().toISOString(), id: cycleId },
        );
        return {
          lastSyncId: sync.id.toString(),
          movedCount: result.movedCount,
          nextCycleId: result.nextCycleId,
          success: true,
        };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'CycleNotFoundError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        throw err;
      }
    },

    cycleUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: CycleUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.cycle.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId);

      try {
        const cycle = await ctx.services.cycle.update(id, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Cycle',
          id,
          cycle,
        );
        return { cycle, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        const error = err as Error;
        if (
          error.name === 'CycleOverlapError' ||
          error.name === 'CycleInvalidDatesError' ||
          error.name === 'CycleNotFoundError'
        ) {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },
  },

  Query: {
    cycle: async (
      _parent: unknown,
      { id }: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const cycle = await ctx.services.cycle.findById(id);
      if (!cycle || cycle.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, cycle.teamId, ctx.userId);
      return cycle;
    },

    cycleBurndown: async (
      _parent: unknown,
      { cycleId }: { cycleId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.cycle.getBurndown(cycleId);
    },

    cycles: async (
      _parent: unknown,
      args: {
        teamId: string;
        includeArchived?: boolean;
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, args.teamId, ctx.userId);

      return ctx.services.cycle.findByTeamId(
        args.teamId,
        args.includeArchived ?? false,
      );
    },

    cycleVelocity: async (
      _parent: unknown,
      { teamId, cycleCount }: { teamId: string; cycleCount?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.cycle.getVelocity(teamId, cycleCount ?? 8);
    },
  },
};
