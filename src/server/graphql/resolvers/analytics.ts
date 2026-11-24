import { GraphQLError } from 'graphql';
import {
  getGuestTeamIds,
  requireAuth,
  requireOrgRole,
  requireTeamMember,
} from '../../middleware/auth';
import {
  type AnalyticsRange,
  InsightsInputError,
  type IssueVisibilityScope,
} from '../../services/analytics.service';
import type { GraphQLContext } from '../context';

interface AnalyticsInput {
  from?: string | null;
  teamId?: string | null;
  to?: string | null;
}

async function buildFilter(
  ctx: GraphQLContext,
  input: AnalyticsInput | null | undefined,
): Promise<{ orgId: string; range: AnalyticsRange; teamId: string }> {
  requireAuth(ctx);
  // teamId is non-null in the GraphQL input, but the GraphQL layer can be
  // bypassed by code that builds AnalyticsInput directly (e.g. a future
  // CLI report). Re-check here so the unbounded scan is impossible.
  const teamId = input?.teamId ?? null;
  if (!teamId) {
    throw new GraphQLError('teamId is required — analytics queries must be team-scoped', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
  return {
    orgId: ctx.orgId,
    range: { from: input?.from ?? null, to: input?.to ?? null },
    teamId,
  };
}

/** The viewer's issue scope: member teams, guest restriction on guest teams. */
async function visibilityScope(ctx: GraphQLContext): Promise<IssueVisibilityScope> {
  requireAuth(ctx);
  const memberships = await ctx.prisma.teamMembership.findMany({
    select: { teamId: true },
    where: { team: { organizationId: ctx.orgId }, userId: ctx.userId },
  });
  return {
    guestTeamIds: await getGuestTeamIds(ctx.prisma, ctx.userId, ctx.orgId),
    memberTeamIds: memberships.map(m => m.teamId),
    userId: ctx.userId,
  };
}

export const analyticsResolvers = {
  Query: {
    analyticsCycleScopeMetrics: async (
      _p: unknown,
      { cycleId }: { cycleId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const cycle = await ctx.prisma.cycle.findFirst({
        select: { id: true, teamId: true },
        where: { id: cycleId, organizationId: ctx.orgId },
      });
      if (!cycle) {
        throw new GraphQLError('Cycle not found', { extensions: { code: 'NOT_FOUND' } });
      }
      await requireTeamMember(ctx.prisma, cycle.teamId, ctx.userId, ctx.orgId);
      return ctx.services.analytics.cycleScopeAndCarryover(cycleId);
    },
    analyticsCycleTimeHistogram: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.cycleTimeHistogram(await buildFilter(ctx, input)),

    analyticsCycleVelocityTrend: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.cycleVelocityTrend(await buildFilter(ctx, input)),

    analyticsLeadTimeHistogram: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.leadTimeHistogram(await buildFilter(ctx, input)),

    analyticsTeamHealth: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.teamHealth(await buildFilter(ctx, input)),

    analyticsThroughputByWeek: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.throughputByWeek(await buildFilter(ctx, input)),

    analyticsTimeInState: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.timeInStateApprox(await buildFilter(ctx, input)),

    analyticsWorkspaceOverview: async (_p: unknown, _a: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      requireOrgRole(ctx, ['owner', 'admin']);
      return ctx.services.analytics.workspaceOverview(ctx.orgId);
    },

    initiativeHealthRollups: async (_p: unknown, _a: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.analytics.initiativeHealthRollups(ctx.orgId, await visibilityScope(ctx));
    },

    insights: async (
      _p: unknown,
      args: { measure: string; slice: string; viewId?: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        return await ctx.services.analytics.insights(
          ctx.orgId,
          ctx.userId,
          args.measure,
          args.slice,
          await visibilityScope(ctx),
          args.viewId,
        );
      } catch (err) {
        if (err instanceof InsightsInputError) {
          throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
        }
        throw err;
      }
    },

    projectBurnup: async (
      _p: unknown,
      { projectId }: { projectId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const result = await ctx.services.analytics.projectBurnup(
        ctx.orgId,
        projectId,
        await visibilityScope(ctx),
      );
      if (!result) {
        throw new GraphQLError('Project not found', { extensions: { code: 'NOT_FOUND' } });
      }
      return result;
    },
  },
};
