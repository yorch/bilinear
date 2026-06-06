import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole, requireTeamMember } from '../../middleware/auth';
import type { AnalyticsRange } from '../../services/analytics.service';
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
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      return ctx.services.analytics.workspaceOverview(ctx.orgId);
    },
  },
};
