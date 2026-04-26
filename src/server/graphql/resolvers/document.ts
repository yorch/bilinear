import { GraphQLError } from 'graphql';
import { requireAuth } from '../../middleware/auth';
import type { DocumentCreateInput, DocumentUpdateInput } from '../../services/document.service';
import { DocumentForbiddenError, DocumentNotFoundError } from '../../services/document.service';
import type { GraphQLContext } from '../context';

export const documentResolvers = {
  Mutation: {
    documentArchive: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);

      const existing = await ctx.services.document.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Document not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

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

      const document = await ctx.services.document.create(ctx.orgId, ctx.userId, input);
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

      const existing = await ctx.services.document.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Document not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      try {
        await ctx.services.document.delete(id, ctx.userId);
      } catch (err) {
        if (err instanceof DocumentNotFoundError) {
          throw new GraphQLError('Document not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }
        if (err instanceof DocumentForbiddenError) {
          throw new GraphQLError('Only the creator can delete this document', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        throw err;
      }

      const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Document', id, null);
      return { lastSyncId: sync.id.toString(), success: true };
    },

    documentUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: DocumentUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const existing = await ctx.services.document.findById(id);
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new GraphQLError('Document not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const document = await ctx.services.document.update(id, input);
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
      const document = await ctx.services.document.findById(id);
      if (!document || document.organizationId !== ctx.orgId) {
        return null;
      }
      return document;
    },

    documents: async (
      _parent: unknown,
      { teamId, projectId }: { teamId?: string; projectId?: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      return ctx.services.document.findByOrg(ctx.orgId, {
        projectId: projectId ?? undefined,
        teamId: teamId ?? undefined,
      });
    },
  },
};
