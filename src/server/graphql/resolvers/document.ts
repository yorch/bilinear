import { GraphQLError } from 'graphql';
import { getSyncVisibility } from '../../lib/sync-visibility';
import { requireAuth } from '../../middleware/auth';
import type {
  DocumentCreateInput,
  DocumentScope,
  DocumentUpdateInput,
} from '../../services/document.service';
import {
  DocumentForbiddenError,
  DocumentInvalidParentError,
  DocumentNotFoundError,
  DocumentValidationError,
} from '../../services/document.service';
import type { GraphQLContext } from '../context';

type AuthedContext = GraphQLContext & { orgId: string; userId: string };

/** The caller's document visibility: their org plus the private teams they cannot see. */
async function documentScope(ctx: AuthedContext): Promise<DocumentScope> {
  const { hiddenTeamIds } = await getSyncVisibility(ctx.prisma, ctx.userId, ctx.orgId);
  return { hiddenTeamIds, orgId: ctx.orgId };
}

/** Service errors -> GraphQLError with `extensions.code`; anything else rethrows. */
function mapDocumentError(err: unknown): never {
  if (err instanceof DocumentNotFoundError) {
    throw new GraphQLError('Document not found', { extensions: { code: 'NOT_FOUND' } });
  }
  if (err instanceof DocumentInvalidParentError || err instanceof DocumentValidationError) {
    throw new GraphQLError(err.message, { extensions: { code: 'BAD_USER_INPUT' } });
  }
  if (err instanceof DocumentForbiddenError) {
    throw new GraphQLError('Only the creator can delete this document', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
  throw err;
}

/** The visible document, or NOT_FOUND — hidden-team and cross-org ids look identical. */
async function requireVisibleDocument(ctx: AuthedContext, id: string) {
  const scope = await documentScope(ctx);
  const existing = await ctx.services.document.findVisibleById(id, scope);
  if (!existing) {
    throw new GraphQLError('Document not found', { extensions: { code: 'NOT_FOUND' } });
  }
  return { existing, scope };
}

export const documentResolvers = {
  Mutation: {
    documentArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      await requireVisibleDocument(ctx, id);

      const document = await ctx.services.document.archive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'A',
        'Document',
        id,
        document,
      );
      return { document, lastSyncId: sync.id.toString(), success: true };
    },

    documentCreate: async (
      _parent: unknown,
      { input }: { input: DocumentCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const { hiddenTeamIds } = await documentScope(ctx);
      let document: Awaited<ReturnType<typeof ctx.services.document.create>>;
      try {
        document = await ctx.services.document.create(ctx.orgId, ctx.userId, input, hiddenTeamIds);
      } catch (err) {
        mapDocumentError(err);
      }
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'Document',
        document.id,
        document,
      );
      return { document, lastSyncId: sync.id.toString(), success: true };
    },

    documentDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      await requireVisibleDocument(ctx, id);

      try {
        await ctx.services.document.delete(id, ctx.userId);
      } catch (err) {
        mapDocumentError(err);
      }

      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Document', id, null);
      return { lastSyncId: sync.id.toString(), success: true };
    },

    documentUnarchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      await requireVisibleDocument(ctx, id);

      const document = await ctx.services.document.unarchive(id);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Document',
        id,
        document,
      );
      return { document, lastSyncId: sync.id.toString(), success: true };
    },

    documentUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: DocumentUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const { scope } = await requireVisibleDocument(ctx, id);

      let document: Awaited<ReturnType<typeof ctx.services.document.update>>;
      try {
        document = await ctx.services.document.update(id, input, scope);
      } catch (err) {
        mapDocumentError(err);
      }
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'U',
        'Document',
        id,
        document,
      );
      return { document, lastSyncId: sync.id.toString(), success: true };
    },
  },

  Query: {
    document: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.document.findVisibleById(id, await documentScope(ctx));
    },

    documents: async (
      _parent: unknown,
      {
        teamId,
        projectId,
        includeArchived,
      }: { teamId?: string; projectId?: string; includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const { hiddenTeamIds } = await documentScope(ctx);
      return ctx.services.document.findByOrg(
        ctx.orgId,
        {
          includeArchived: includeArchived ?? false,
          projectId: projectId ?? undefined,
          teamId: teamId ?? undefined,
        },
        hiddenTeamIds,
      );
    },
  },
};
