import { GraphQLError } from 'graphql';
import { requireAuth, requireOrgRole, requireTeamMemberNotGuest } from '../../middleware/auth';
import { GithubImportService } from '../../services/github-import.service';
import type { ImportMapping } from '../../services/import.service';
import type { GraphQLContext } from '../context';
import { mapServiceError } from '../types/errors';

const GITHUB_IMPORT_ERRORS = {
  BAD_USER_INPUT: [
    'GithubInvalidRepoError',
    'GithubImportFieldUnavailableError',
    'GithubTokenInvalidError',
  ],
  NOT_FOUND: ['GithubRepoNotFoundError'],
  RATELIMITED: ['GithubRateLimitedError'],
} as const;

function githubImporter(ctx: GraphQLContext): GithubImportService {
  return new GithubImportService(
    ctx.prisma,
    {
      comment: ctx.services.comment,
      customField: ctx.services.customField,
      issue: ctx.services.issue,
      label: ctx.services.label,
    },
    ctx.config,
  );
}

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
    githubImportRun: async (
      _parent: unknown,
      {
        input,
      }: {
        input: {
          includeClosed?: boolean | null;
          includeComments?: boolean | null;
          page?: number | null;
          repo: string;
          startPage?: number | null;
          teamId: string;
          token?: string | null;
        };
      },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMemberNotGuest(ctx.prisma, input.teamId, ctx.userId, ctx.orgId);

      let chunk: Awaited<ReturnType<GithubImportService['importPage']>>;
      try {
        chunk = await githubImporter(ctx).importPage(ctx.orgId, ctx.userId, input.teamId, input);
      } catch (err) {
        mapServiceError(err, GITHUB_IMPORT_ERRORS);
      }

      // Every row the chunk wrote gets a SyncAction, parents first, so other
      // clients see the whole import without a reload. Sequential keeps the
      // commit order stable.
      const sync = ctx.services.sync;
      let lastSyncId = await sync.getLastSyncId(ctx.orgId);
      const emit = async (action: 'I' | 'U', model: string, id: string, data: object | null) => {
        const row = await sync.createSyncAction(ctx.orgId, action, model, id, data);
        lastSyncId = row.id.toString();
      };
      if (chunk.createdFieldDefinition) {
        await emit(
          'I',
          'CustomFieldDefinition',
          chunk.createdFieldDefinition.id,
          chunk.createdFieldDefinition,
        );
      }
      for (const label of chunk.createdLabels) {
        await emit('I', 'IssueLabel', label.id, label);
      }
      for (const issue of chunk.createdIssues) {
        await emit('I', 'Issue', issue.id, issue);
        const values = chunk.fieldValues.filter(v => v.issueId === issue.id);
        if (values.length > 0) {
          await emit('U', 'Issue', issue.id, { customFieldValues: values });
        }
      }
      for (const comment of chunk.createdComments) {
        await emit('I', 'Comment', comment.id, comment);
      }

      return {
        closedAsOpen: chunk.closedAsOpen,
        commentsCreated: chunk.createdComments.length,
        commentsTruncated: chunk.commentsTruncated,
        created: chunk.createdIssues.length,
        errors: chunk.errors,
        existing: chunk.existing,
        labelsCreated: chunk.createdLabels.length,
        lastSyncId,
        limitReached: chunk.limitReached,
        nextPage: chunk.nextPage,
        processed: chunk.processed,
        success: true,
        tokenSource: chunk.tokenSource,
      };
    },
  },

  Query: {
    csvImportPreview: async (_parent: unknown, { csv }: { csv: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.import.preview(csv);
    },
    githubImportPreview: async (
      _parent: unknown,
      { repo, teamId, token }: { repo: string; teamId: string; token?: string | null },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireTeamMemberNotGuest(ctx.prisma, teamId, ctx.userId, ctx.orgId);
      try {
        return await githubImporter(ctx).preview(ctx.orgId, ctx.userId, { repo, token });
      } catch (err) {
        mapServiceError(err, GITHUB_IMPORT_ERRORS);
      }
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
      requireOrgRole(ctx, ['owner', 'admin']);
      const data = await ctx.services.import.exportData(ctx.orgId, teamId ?? undefined);
      return JSON.stringify(data);
    },
  },
};
