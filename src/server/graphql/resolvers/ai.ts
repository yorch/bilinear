import { GraphQLError } from 'graphql';
import { visibleEntityIds } from '../../lib/entity-visibility';
import { requireAuth, requireIssueAccessNotGuestOrOwn } from '../../middleware/auth';
import { AiDisabledError, AiRequestError } from '../../services/ai.service';
import type { GraphQLContext } from '../context';
import { getRequestVisibility } from '../request-visibility';

/** The issue, after org + team/guest access checks; NOT_FOUND hides cross-org ids. */
async function requireAccessibleIssue(
  ctx: GraphQLContext & { orgId: string; userId: string },
  issueId: string,
) {
  const issue = await ctx.services.issue.findById(issueId);
  if (!issue || issue.organizationId !== ctx.orgId) {
    throw new GraphQLError('Issue not found', { extensions: { code: 'NOT_FOUND' } });
  }
  await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);
}

function mapAiError(err: unknown): never {
  if (err instanceof AiDisabledError) {
    throw new GraphQLError(err.message, { extensions: { code: 'FORBIDDEN' } });
  }
  if (err instanceof AiRequestError) {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  throw err;
}

export const aiResolvers = {
  Mutation: {
    aiFindDuplicateIssues: async (
      _parent: unknown,
      { issueId }: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireAccessibleIssue(ctx, issueId);
      try {
        await ctx.services.ai.assertEnabled(ctx.orgId);
        const found = await ctx.services.ai.findDuplicates(ctx.orgId, issueId);
        // Candidates come from an org-wide search; drop any the caller cannot see.
        const vis = await getRequestVisibility(ctx);
        const visible = await visibleEntityIds(
          ctx.prisma,
          vis,
          ctx.orgId,
          'Issue',
          found.map(d => d.id),
        );
        const duplicates = found.filter(d => visible.has(d.id));
        return { duplicates, success: true };
      } catch (err) {
        mapAiError(err);
      }
    },

    aiSuggestIssueTitle: async (
      _parent: unknown,
      { description }: { description: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      try {
        await ctx.services.ai.assertEnabled(ctx.orgId);
        const title = await ctx.services.ai.suggestTitle(description);
        return { success: true, title };
      } catch (err) {
        mapAiError(err);
      }
    },

    aiSummarizeIssue: async (
      _parent: unknown,
      { issueId }: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireAccessibleIssue(ctx, issueId);
      try {
        await ctx.services.ai.assertEnabled(ctx.orgId);
        const summary = await ctx.services.ai.summarizeIssue(ctx.orgId, issueId);
        return { success: true, summary };
      } catch (err) {
        mapAiError(err);
      }
    },
  },

  Query: {
    aiAvailable: async (_parent: unknown, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      // `isConfigured` is async now that provider selection resolves through
      // the config chain. Without the await this guard is dead — `!Promise` is
      // always false — and the short-circuit that avoids a DB read when AI is
      // unconfigured never fires.
      if (!(await ctx.services.ai.isConfigured())) {
        return false;
      }
      try {
        await ctx.services.ai.assertEnabled(ctx.orgId);
        return true;
      } catch {
        return false;
      }
    },
  },
};
