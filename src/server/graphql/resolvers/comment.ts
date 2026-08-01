import { GraphQLError } from 'graphql';
import type { Comment, CommentReaction } from '../../../generated/prisma';
import { logger } from '../../lib/logger';
import {
  requireAuth,
  requireIssueAccessNotGuestOrOwn,
  requireTeamMember,
} from '../../middleware/auth';
import type { CommentCreateInput, CommentUpdateInput } from '../../services/comment.service';
import { extractMentionedUserIds } from '../../services/comment.service';
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
  await requireTeamMember(ctx.prisma, target.teamId, ctx.userId, ctx.orgId);
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
  if (error.name === 'CommentValidationError') {
    throw new GraphQLError(error.message, {
      extensions: { code: 'BAD_USER_INPUT' },
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
    // `author` is `User!`, so a row whose relation was not hydrated would null
    // the comment and cascade up through the non-null `replies`/`comments`
    // lists to `data: null`. Nesting is now capped at one level so every row
    // `COMMENT_INCLUDE` returns carries an author, but fall back to a batched
    // lookup rather than trusting that — rows created before the cap existed
    // can still be deeper.
    author: (comment: CommentWithRelations, _args: unknown, ctx: GraphQLContext) =>
      comment.author ?? ctx.loaders.user.load(comment.authorId),
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
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);

      let comment: Awaited<ReturnType<typeof ctx.services.comment.create>>;
      try {
        comment = await ctx.services.comment.create(ctx.userId, input);
      } catch (err) {
        handleCommentError(err);
      }
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

      // Mention notifications: parse @user mentions out of the comment's
      // TipTap doc (bodyData) and notify anyone mentioned who isn't already
      // an issue subscriber (subscribers were already notified above via
      // notifyCommentSubscribers). Membership filtering + fan-out lives in
      // NotificationService.notifyMentions (a Resolver→Service violation to
      // keep inline here) — fire-and-forget, matching every other side
      // effect on this path.
      void ctx.services.notification
        .notifyMentions({
          actorId: ctx.userId,
          excerpt: comment.body.slice(0, 200),
          issueId: issue.id,
          mentionedUserIds: extractMentionedUserIds(input.bodyData),
          orgId: ctx.orgId,
          teamId: issue.teamId,
        })
        .catch(err => logger.error({ err }, 'Failed to create mention notifications'));

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
        void ctx.services.issueActivity
          .create({
            actorId: ctx.userId,
            field: 'commentResolved',
            issueId: comment.issueId,
            newValue: id,
          })
          .catch(() => {});
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
        void ctx.services.issueActivity
          .create({
            actorId: ctx.userId,
            field: 'commentUnresolved',
            issueId: comment.issueId,
            oldValue: id,
          })
          .catch(() => {});
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
      // Guest visibility: a plain requireTeamMember let a guest read
      // comments on ANY issue on their team by id — the same gap as the
      // top-level `issue` query. Guests may only read comments on issues
      // they created or are assigned to.
      await requireIssueAccessNotGuestOrOwn(ctx.prisma, issue, ctx.userId, ctx.orgId);
      return ctx.services.comment.findByIssueId(issueId, includeArchived ?? false);
    },
  },
};
