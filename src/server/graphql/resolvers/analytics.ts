import { requireAuth, requireTeamMember } from '../../middleware/auth';
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
): Promise<{ orgId: string; range: AnalyticsRange; teamId?: string | null }> {
  requireAuth(ctx);
  const teamId = input?.teamId ?? null;
  if (teamId) {
    await requireTeamMember(ctx.prisma, teamId, ctx.userId, ctx.orgId);
  }
  return {
    orgId: ctx.orgId,
    range: { from: input?.from ?? null, to: input?.to ?? null },
    teamId,
  };
}

export const analyticsResolvers = {
  Query: {
    analyticsCycleTimeHistogram: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.cycleTimeHistogram(await buildFilter(ctx, input)),

    analyticsLeadTimeHistogram: async (
      _p: unknown,
      { input }: { input?: AnalyticsInput | null },
      ctx: GraphQLContext,
    ) => ctx.services.analytics.leadTimeHistogram(await buildFilter(ctx, input)),

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
  },
};
