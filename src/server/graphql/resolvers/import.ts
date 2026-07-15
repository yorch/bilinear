import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole, requireTeamMemberNotGuest } from '../../middleware/auth';
import type { ImportMapping } from '../../services/import.service';
import type { GraphQLContext } from '../context';

export const importResolvers = {
  Mutation: {
    csvImportIssues: async (
      _parent: unknown,
      { input }: { input: { teamId: string; csv: string; mapping: ImportMapping } },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      // Importing creates issues on the team — same bar as issueCreate.
      await requireTeamMemberNotGuest(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);

      let result: Awaited<ReturnType<typeof ctx.services.import.importIssues>>;
      try {
        result = await ctx.services.import.importIssues(
          ctx.orgId,
          ctx.userId,
          input.teamId,
          input.csv,
          input.mapping,
        );
      } catch (err) {
        throw new GraphQLError((err as Error).message, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Emit one SyncAction per created issue so connected clients see the
      // import in real time. Sequential to keep commit ordering stable.
      let lastSyncId = await ctx.services.sync.getLastSyncId(ctx.orgId);
      for (const issue of result.createdIssues) {
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'Issue',
          issue.id,
          issue,
        );
        lastSyncId = sync.id.toString();
      }

      return {
        created: result.created,
        errors: result.errors,
        lastSyncId,
        skipped: result.skipped,
        success: true,
      };
    },
  },

  Query: {
    csvImportPreview: async (_parent: unknown, { csv }: { csv: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.import.preview(csv);
    },

    organizationExport: async (
      _parent: unknown,
      { teamId }: { teamId?: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      // Exporting is an admin action (a full dump of every issue in the
      // org, or of a whole team) — was previously requireAuth-only, so
      // ANY member (including guests) could pull every other team's issue
      // data. Restrict to org owner/admin, matching teamCreate/teamDelete's
      // bar.
      await requireOrgRole(ctx.prisma, ctx.orgId, ctx.userId, ['owner', 'admin']);
      const data = await ctx.services.import.exportData(ctx.orgId, teamId ?? undefined);
      return JSON.stringify(data);
    },
  },
};
