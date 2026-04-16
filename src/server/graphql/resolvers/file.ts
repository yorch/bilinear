import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GraphQLError } from 'graphql';
import { requireAuth } from '../../middleware/auth';
import type { GraphQLContext } from '../context';

function getUploadDir(): string {
  return process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : resolve(process.cwd(), 'uploads');
}

export const fileResolvers = {
  Issue: {
    files: (parent: { id: string }, _args: unknown, ctx: GraphQLContext) => {
      requireAuth(ctx);
      return ctx.prisma.file.findMany({
        orderBy: { createdAt: 'asc' },
        where: { issueId: parent.id },
      });
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

      const lastSyncId = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'D',
        'File',
        file.id,
        {},
      );

      await ctx.prisma.file.delete({ where: { id: args.id } });

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
      return ctx.prisma.file.findMany({
        orderBy: { createdAt: 'asc' },
        where: { issueId: args.issueId },
      });
    },
  },
};
