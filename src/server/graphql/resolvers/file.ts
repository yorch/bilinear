import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { GraphQLError } from 'graphql';
import { getUploadDir } from '../../lib/upload-dir';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

export const fileResolvers = {
  Issue: {
    files: (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.file.getIssueFiles(parent.id);
    },
  },

  Mutation: {
    fileDelete: async (
      _parent: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      const file = await ctx.prisma.file.findUnique({
        where: { id: args.id },
      });
      if (!file) {
        throw new GraphQLError('File not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      if (file.uploaderId !== ctx.userId) {
        throw new GraphQLError('Forbidden', {
          extensions: { code: 'FORBIDDEN' },
        });
      }

      // Delete from DB before creating the sync action so state stays consistent
      // if the sync action write fails.
      await ctx.services.file.deleteFile(args.id, ctx.userId);

      const lastSyncId = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'File',
        file.id,
        {},
      );

      // Best-effort: delete the physical file (ignore errors if already gone).
      try {
        await unlink(join(getUploadDir(), file.key));
      } catch {}

      return { lastSyncId: String(lastSyncId.id), success: true };
    },
  },

  Query: {
    issueFiles: (
      _parent: unknown,
      args: { issueId: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      return ctx.services.file.getIssueFiles(args.issueId);
    },
  },
};
