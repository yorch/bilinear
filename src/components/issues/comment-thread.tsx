'use client';

import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import {
  COMMENT_CREATE_MUTATION,
  COMMENT_DELETE_MUTATION,
  COMMENT_REACTION_ADD_MUTATION,
  COMMENT_REACTION_REMOVE_MUTATION,
  COMMENT_RESOLVE_MUTATION,
  COMMENT_UNRESOLVE_MUTATION,
  GET_COMMENTS_QUERY,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import type { MentionItem } from '../editor/mention-list';
import { CommentCard, type CommentItem } from './comment-card';
import { CommentComposer } from './comment-composer';

interface CommentThreadProps {
  currentUserId?: string;
  issueId: string;
  mentionIssues?: MentionItem[];
  mentionUsers?: MentionItem[];
  teamId?: string;
}

function updateCommentInTree(
  comments: CommentItem[],
  id: string,
  updater: (c: CommentItem) => CommentItem,
): CommentItem[] {
  return comments.map(c => {
    if (c.id === id) {
      return updater(c);
    }
    if (c.replies.length > 0) {
      return { ...c, replies: updateCommentInTree(c.replies, id, updater) };
    }
    return c;
  });
}

export function CommentThread({
  issueId,
  teamId,
  currentUserId,
  mentionIssues,
  mentionUsers,
}: CommentThreadProps) {
  const t = useTranslations();
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showReplyTo, setShowReplyTo] = useState<string | null>(null);

  const {
    data: comments,
    setData: setComments,
    loading,
    error: loadError,
    refetch: fetchComments,
  } = useRetryableFetch<CommentItem[]>(
    async () => {
      // gqlQuery throws on a GraphQL error, which is what makes the
      // `InlineRetry` branch below reachable — swallowing it and returning []
      // rendered a failed load as "no comments".
      return await gqlQuery<CommentItem[]>(GET_COMMENTS_QUERY, { issueId }, 'comments');
    },
    [issueId],
    [],
  );

  /**
   * Returns `false` when the post was rejected, so the caller keeps the body the
   * user typed. `gqlMutate` throws on a GraphQL-level rejection (FORBIDDEN from
   * the guest guard, a body-length cap) that plain `gql()` resolved with
   * `errors` set — silently destroying a long comment.
   */
  const submitComment = async (body: string, parentId?: string): Promise<boolean> => {
    if (!body.trim() || body === '<p></p>') {
      return false;
    }
    setSubmitting(true);
    try {
      await gqlMutate(COMMENT_CREATE_MUTATION, {
        input: { body, issueId, parentId: parentId ?? null },
      });
      setNewComment('');
      setShowReplyTo(null);
      await fetchComments({ silent: true });
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.comments.failedToPost')));
      return false;
    } finally {
      setSubmitting(false);
    }
  };

  const deleteComment = async (id: string) => {
    try {
      await gqlMutate(COMMENT_DELETE_MUTATION, { id });
      setComments(prev =>
        prev
          .filter(c => c.id !== id)
          .map(c => ({ ...c, replies: c.replies.filter(r => r.id !== id) })),
      );
      toast.success(t('issueDetail.comments.deleted'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.comments.failedToDelete')));
    }
  };

  const toggleResolve = async (comment: CommentItem) => {
    try {
      const isResolved = !!comment.resolvedAt;
      const mutation = isResolved ? COMMENT_UNRESOLVE_MUTATION : COMMENT_RESOLVE_MUTATION;
      const key = isResolved ? 'commentUnresolve' : 'commentResolve';
      type ResolvePayload = {
        comment: { id: string; resolvedAt: string | null };
      };
      const data = await gqlMutate(mutation, { id: comment.id });
      const updated = (data as Record<string, ResolvePayload | undefined>)[key]?.comment;
      if (updated) {
        setComments(prev =>
          updateCommentInTree(prev, updated.id, c => ({
            ...c,
            resolvedAt: updated.resolvedAt,
          })),
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.comments.failedToUpdate')));
    }
  };

  const toggleReaction = async (commentId: string, emoji: string, hasReacted: boolean) => {
    try {
      if (hasReacted) {
        await gqlMutate(COMMENT_REACTION_REMOVE_MUTATION, { commentId, emoji });
      } else {
        await gqlMutate(COMMENT_REACTION_ADD_MUTATION, { commentId, emoji });
      }
      await fetchComments({ silent: true });
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.comments.failedToUpdateReaction')));
    }
  };

  if (loading) {
    return (
      <LoadingRegion className="space-y-3 py-2">
        {[1, 2].map(i => (
          <div className="flex gap-3" key={i}>
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-12" />
            </div>
          </div>
        ))}
      </LoadingRegion>
    );
  }

  return (
    <div className="space-y-1">
      {loadError && comments.length === 0 && (
        <InlineRetry message={t('issueDetail.comments.failedToLoad')} onRetry={fetchComments} />
      )}

      {/* Comment list */}
      {comments.map(comment => (
        <CommentCard
          comment={comment}
          currentUserId={currentUserId}
          issueId={issueId}
          key={comment.id}
          mentionIssues={mentionIssues}
          mentionUsers={mentionUsers}
          onConvertToSubIssue={id => setComments(prev => prev.filter(c => c.id !== id))}
          onDelete={deleteComment}
          onReply={id => setShowReplyTo(showReplyTo === id ? null : id)}
          onSubmitReply={submitComment}
          onToggleReaction={toggleReaction}
          onToggleResolve={toggleResolve}
          onUpdate={updated =>
            setComments(prev => updateCommentInTree(prev, updated.id, () => updated))
          }
          showReplyTo={showReplyTo}
          teamId={teamId}
        />
      ))}

      {/* New comment composer */}
      <div className="mt-4 border-t border-border pt-4">
        <CommentComposer
          issueId={issueId}
          mentionIssues={mentionIssues}
          mentionUsers={mentionUsers}
          onChange={setNewComment}
          onSubmit={body => submitComment(body)}
          placeholder={t('issueDetail.comments.writePlaceholder')}
          submitting={submitting}
          value={newComment}
        />
      </div>
    </div>
  );
}
