import { GraphQLError } from 'graphql';
import type { Comment, CommentReaction } from '../../../generated/prisma';
import { logger } from '../../lib/logger';
import { requireAuth, requireTeamMember } from '../../middleware/auth';
import type { CommentCreateInput, CommentUpdateInput } from '../../services/comment.service';
import type { GraphQLContext } from '../context';

/** Verifies org + team access for a comment via CommentService.findAccessTarget,
 *  then chains the existing requireTeamMember middleware. Must be called after
 *  requireAuth(ctx) so ctx.userId and ctx.orgId are non-null. */
async function requireCommentAccess(
  ctx: GraphQLContext & { userId: string; orgId: string },
  commentId: string,
): Promise<void> {
  const target = await ctx.services.comment.findAccessTarget(commentId, ctx.orgId);
  if (!target) {
    throw new GraphQLError('Comment not found', {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  await requireTeamMember(ctx.prisma, target.teamId, ctx.userId);
}

function handleCommentError(err: unknown): never {
  const error = err as Error;
  if (error.name === 'CommentNotFoundError' || error.name === 'CommentReactionNotFoundError') {
    throw new GraphQLError(error.message, {
      extensions: { code: 'NOT_FOUND' },
    });
  }
  if (error.name === 'CommentForbiddenError') {
    throw new GraphQLError(error.message, {
      extensions: { code: 'FORBIDDEN' },
    });
  }
  throw err;
}

type CommentWithRelations = Comment & {
  author: unknown;
  reactions: unknown[];
  replies: unknown[];
  resolvedBy: unknown;
};

export const commentResolvers = {
  Comment: {
    author: (comment: CommentWithRelations) => comment.author,
    parent: async (comment: Comment, _args: unknown, ctx: GraphQLContext) => {
      if (!comment.parentId) {
        return null;
      }
      return ctx.services.comment.findById(comment.parentId);
    },
    reactions: (comment: CommentWithRelations) => comment.reactions ?? [],
    replies: (comment: CommentWithRelations) => comment.replies ?? [],
    replyCount: (comment: CommentWithRelations) => (comment.replies as unknown[])?.length ?? 0,
    resolvedBy: (comment: CommentWithRelations) => comment.resolvedBy ?? null,
  },
  CommentReaction: {
    user: (reaction: CommentReaction & { user: unknown }) => reaction.user,
  },
  Mutation: {
    commentCreate: async (
      _parent: unknown,
      { input }: { input: CommentCreateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const issue = await ctx.services.issue.findById(input.issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);

      const comment = await ctx.services.comment.create(ctx.userId, input);
      const sync = await ctx.services.sync.createSyncAction(
        ctx.orgId,
        'I',
        'Comment',
        comment.id,
        comment,
      );

      // Notify subscribers
      await ctx.services.notification
        .notifyCommentSubscribers(ctx.orgId, comment.issueId, ctx.userId, comment.id)
        .catch(() => {}); // non-fatal

      // Webhook fan-out — fire-and-forget, scoped to the issue's team.
      void ctx.services.webhook
        .dispatchEvent(ctx.orgId, 'comment.created', comment, issue.teamId)
        .catch(err => logger.error({ err }, 'webhook dispatch failed: comment.created'));

      return { comment, lastSyncId: sync.id.toString(), success: true };
    },
    commentDelete: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, id);
      try {
        await ctx.services.comment.delete(id, ctx.userId);
        const sync = await ctx.services.sync.createSyncAction(ctx.orgId, 'D', 'Comment', id, null);
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        handleCommentError(err);
      }
    },
    commentReactionAdd: async (
      _parent: unknown,
      { commentId, emoji }: { commentId: string; emoji: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, commentId);
      try {
        const reaction = await ctx.services.comment.addReaction(commentId, ctx.userId, emoji);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'I',
          'CommentReaction',
          reaction.id,
          reaction,
        );
        return { lastSyncId: sync.id.toString(), reaction, success: true };
      } catch (err) {
        handleCommentError(err);
      }
    },
    commentReactionRemove: async (
      _parent: unknown,
      { commentId, emoji }: { commentId: string; emoji: string },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, commentId);
      try {
        const result = await ctx.services.comment.removeReaction(commentId, ctx.userId, emoji);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'D',
          'CommentReaction',
          result.id,
          null,
        );
        return { lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        handleCommentError(err);
      }
    },
    commentResolve: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, id);
      try {
        const comment = await ctx.services.comment.resolve(id, ctx.userId);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Comment',
          comment.id,
          comment,
        );
        return { comment, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        handleCommentError(err);
      }
    },
    commentUnresolve: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, id);
      try {
        const comment = await ctx.services.comment.unresolve(id);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Comment',
          comment.id,
          comment,
        );
        return { comment, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        handleCommentError(err);
      }
    },
    commentUpdate: async (
      _parent: unknown,
      { id, input }: { id: string; input: CommentUpdateInput },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, id);
      try {
        const comment = await ctx.services.comment.update(id, ctx.userId, input);
        const sync = await ctx.services.sync.createSyncAction(
          ctx.orgId,
          'U',
          'Comment',
          comment.id,
          comment,
        );
        const issue = await ctx.services.issue.findById(comment.issueId);
        if (issue) {
          void ctx.services.webhook
            .dispatchEvent(ctx.orgId, 'comment.updated', comment, issue.teamId)
            .catch(err => logger.error({ err }, 'webhook dispatch failed: comment.updated'));
        }
        return { comment, lastSyncId: sync.id.toString(), success: true };
      } catch (err) {
        handleCommentError(err);
      }
    },
  },
  Query: {
    comment: async (_parent: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      requireAuth(ctx);
      await requireCommentAccess(ctx, id);
      return ctx.services.comment.findById(id);
    },
    comments: async (
      _parent: unknown,
      { issueId, includeArchived }: { issueId: string; includeArchived?: boolean },
      ctx: GraphQLContext,
    ) => {
      requireAuth(ctx);
      const issue = await ctx.services.issue.findById(issueId);
      if (!issue || issue.organizationId !== ctx.orgId) {
        throw new GraphQLError('Issue not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }
      await requireTeamMember(ctx.prisma, issue.teamId, ctx.userId);
      return ctx.services.comment.findByIssueId(issueId, includeArchived ?? false);
    },
  },
};
