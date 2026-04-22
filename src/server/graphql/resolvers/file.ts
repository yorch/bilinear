import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { GraphQLError } from 'graphql';
import { getUploadDir } from '../../lib/upload-dir';
import { requireAuth } from '../../middleware/auth';
import {
  FileForbiddenError,
  FileNotFoundError,
} from '../../services/file.service';
import type { GraphQLContext } from '../context';

export const fileResolvers = {
  Issue: {
    files: (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.services.file.getIssueFiles(parent.id, ctx.orgId);
    },
  },

  Mutation: {
    fileDelete: async (
      _parent: unknown,
      args: { id: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);

      // deleteFile checks existence and ownership; returns the deleted record.
      const file = await ctx.services.file
        .deleteFile(args.id, ctx.userId)
        .catch(err => {
          if (err instanceof FileNotFoundError) {
            throw new GraphQLError('File not found', {
              extensions: { code: 'NOT_FOUND' },
            });
          }
          if (err instanceof FileForbiddenError) {
            throw new GraphQLError('Forbidden', {
              extensions: { code: 'FORBIDDEN' },
            });
          }
          throw err;
        });

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
      return ctx.services.file.getIssueFiles(args.issueId, ctx.orgId);
    },
  },
};
