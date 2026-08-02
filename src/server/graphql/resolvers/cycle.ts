import { GraphQLError } from 'graphql';
import type { Cycle } from '../../../generated/prisma';
import { logger } from '../../lib/logger';
import { isTeamGuest, requireAuth, requireTeamMember } from '../../middleware/auth';
import type { CycleCreateInput, CycleUpdateInput } from '../../services/cycle.service';
import { IssueService } from '../../services/issue.service';
import type { GraphQLContext } from '../context';

export const cycleResolvers = {
  Cycle: {
    issues: async (cycle: Cycle, _args: unknown, ctx: GraphQLContext) => {
      // Guest visibility: a guest on the cycle's team only sees issues
      // they created or are assigned to. Non-guests see the full set.
      // Without this check, Cycle.issues is a backdoor around the
      // top-level `issues` query's guest filter.
      //
      // Snooze hide is applied to both branches — the non-guest branch
      // delegates to `findActiveByCycleId` which now includes the
      // predicate; the guest branch composes it via AND so it stacks
      // cleanly with the creator/assignee OR.
      const userId = ctx.userId;
      const orgId = ctx.orgId;
      if (userId && orgId && (await isTeamGuest(ctx.prisma, cycle.teamId, userId, orgId))) {
        return ctx.prisma.issue.findMany({
          orderBy: { sortOrder: 'asc' },
          where: {
            AND: [
              { OR: [{ creatorId: userId }, { assigneeId: userId }] },
              IssueService.snoozeHideClause(),
            ],
            archivedAt: null,
            cycleId: cycle.id,
            trashed: false,
          },
        });
      }
      return ctx.services.issue.findActiveByCycleId(cycle.id);
    },

    // `progress`/`scope` are computed, not stored. Until these resolvers
    // existed the SDL declared both fields with nothing behind them, so the
    // default resolver read the `cycles.progress`/`scope` columns — which
    // nothing ever wrote, making every query answer 0.
    progress: async (cycle: Cycle, _args: unknown, ctx: GraphQLContext) => {
      const result = await ctx.loaders.cycleProgress.load(cycle.id);
      return result.progress;
    },

    scope: async (cycle: Cycle, _args: unknown, ctx: GraphQLContext) => {
      const result = await ctx.loaders.cycleProgress.load(cycle.id);
      return result.scope;
    },

    team: async (cycle: Cycle, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.team.load(cycle.teamId),
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
      await requireTeamMember(ctx.prisma, cycle.teamId, ctx.userId, ctx.orgId);

      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      // The service enforces the team-consistency invariant (CycleCrossTeamError).
      try {
        await ctx.services.cycle.addIssueToCycle(cycleId, issueId, cycle.teamId, issue.teamId);
      } catch (err) {
        const error = err as Error;
        if (error.name === 'CycleCrossTeamError') {
          throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        throw err;
      }
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

    cycleArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.cycle.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      const cycle = await ctx.services.cycle.archive(id);
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'A', 'Cycle', id, cycle);
      return { cycle, lastSyncId: sync.id.toString(), success: true };
    },

    cycleCreate: async (
      _parent: unknown,
      { input }: { input: CycleCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);

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
        void ctx.services.webhook
          .dispatchEvent(ctx.orgId, 'cycle.created', cycle, cycle.teamId)
          .catch(err => logger.error({ err }, 'webhook dispatch failed: cycle.created'));
        return { cycle, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        const error = err as Error;
        if (error.name === 'CycleOverlapError' || error.name === 'CycleInvalidDatesError') {
          throw new GraphQLError(error.message, {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        throw err;
      }
    },

    cycleDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.cycle.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      const { unassignedIssueIds } = await ctx.services.cycle.delete(id);
      // Re-read the affected issues so remote clients see the cleared
      // cycleId/addedToCycleAt — without these SyncActions the issues
      // keep pointing at a cycle that no longer exists until next bootstrap.
      if (unassignedIssueIds.length > 0) {
        const refreshed = await ctx.services.issue.findByIdsInOrg(unassignedIssueIds, ctx.orgId);
        for (const row of refreshed) {
          await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Issue', row.id, row);
        }
      }
      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Cycle', id, null);
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
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId, ctx.orgId);

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
      { cycleId }: { cycleId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.cycle.findById(cycleId);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      try {
        const result = await ctx.services.cycle.rollover(ctx.orgId, cycleId);

        // Broadcast cycle completion. Re-fetch the full row: the client's
        // apply is a whole-object replace, so a two-field payload would strip
        // teamId/number/name/startsAt/endsAt from the cached cycle (dropping it
        // out of `findByTeamId` and scrambling the date sort) — and it would be
        // persisted to Dexie in that state. The WS server's auto-rollover path
        // does the same thing for the same reason.
        const completed = await ctx.services.cycle.findById(cycleId);
        let lastSync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Cycle',
          cycleId,
          completed,
        );
        void ctx.services.webhook
          .dispatchEvent(
            ctx.orgId,
            'cycle.completed',
            { id: cycleId, movedCount: result.movedCount },
            existing.teamId,
          )
          .catch(err => logger.error({ err }, 'webhook dispatch failed: cycle.completed'));

        // Broadcast each moved issue so connected clients update their cycle view
        if (result.movedIssueIds.length > 0) {
          const movedIssues = await ctx.services.issue.findByIdsInOrg(
            result.movedIssueIds,
            ctx.orgId,
          );
          for (const issue of movedIssues) {
            lastSync = await ctx.services.sync.createSyncAction(
              ctx.orgId,
              'U',
              'Issue',
              issue.id,
              issue,
            );
          }
        }

        return {
          lastSyncId: lastSync.id.toString(),
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
      await requireTeamMember(ctx.prisma, existing.teamId, ctx.userId, ctx.orgId);

      try {
        const cycle = await ctx.services.cycle.update(id, input);
        const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'U', 'Cycle', id, cycle);
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
    cycle: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const cycle = await ctx.services.cycle.findById(id);
      if (!cycle || cycle.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, cycle.teamId, ctx.userId, ctx.orgId);
      return cycle;
    },

    cycleBurndown: async (
      _parent: unknown,
      { cycleId }: { cycleId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const cycle = await ctx.services.cycle.findById(cycleId);
      if (!cycle || cycle.organizationId !== ctx.orgId) {
        throw new GraphQLError('Cycle not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, cycle.teamId, ctx.userId, ctx.orgId);

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
      await requireTeamMember(ctx.prisma, args.teamId, ctx.userId, ctx.orgId);

      return ctx.services.cycle.findByTeamId(args.teamId, args.includeArchived ?? false);
    },

    cycleVelocity: async (
      _parent: unknown,
      { teamId, cycleCount }: { teamId: string; cycleCount?: number },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
      return ctx.services.cycle.getVelocity(teamId, cycleCount ?? 8);
    },
  },
};
