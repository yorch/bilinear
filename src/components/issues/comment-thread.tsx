'use client';

import { useCallback, useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
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
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showReplyTo, setShowReplyTo] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    try {
      const res = await gql(GET_COMMENTS_QUERY, { issueId });
      const data = res.data as { comments?: CommentItem[] } | undefined;
      setComments(data?.comments ?? []);
    } catch {
      // Non-fatal — activity section degrades gracefully
    } finally {
      setLoading(false);
    }
  }, [issueId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const submitComment = async (body: string, parentId?: string) => {
    if (!body.trim() || body === '<p></p>') {
      return;
    }
    setSubmitting(true);
    try {
      await gql(COMMENT_CREATE_MUTATION, {
        input: { body, issueId, parentId: parentId ?? null },
      });
      setNewComment('');
      setShowReplyTo(null);
      await fetchComments();
    } catch {
      toast.error('Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteComment = async (id: string) => {
    try {
      await gql(COMMENT_DELETE_MUTATION, { id });
      setComments(prev =>
        prev
          .filter(c => c.id !== id)
          .map(c => ({ ...c, replies: c.replies.filter(r => r.id !== id) })),
      );
      toast.success('Comment deleted');
    } catch {
      toast.error('Failed to delete comment');
    }
  };

  const toggleResolve = async (comment: CommentItem) => {
    try {
      const isResolved = !!comment.resolvedAt;
      const mutation = isResolved ? COMMENT_UNRESOLVE_MUTATION : COMMENT_RESOLVE_MUTATION;
      const key = isResolved ? 'commentUnresolve' : 'commentResolve';
      const res = await gql(mutation, { id: comment.id });
      type ResolvePayload = {
        comment: { id: string; resolvedAt: string | null };
      };
      const updated = (res.data as Record<string, ResolvePayload | undefined> | undefined)?.[key]
        ?.comment;
      if (updated) {
        setComments(prev =>
          updateCommentInTree(prev, updated.id, c => ({
            ...c,
            resolvedAt: updated.resolvedAt,
          })),
        );
      }
    } catch {
      toast.error('Failed to update comment');
    }
  };

  const toggleReaction = async (commentId: string, emoji: string, hasReacted: boolean) => {
    try {
      if (hasReacted) {
        await gql(COMMENT_REACTION_REMOVE_MUTATION, { commentId, emoji });
      } else {
        await gql(COMMENT_REACTION_ADD_MUTATION, { commentId, emoji });
      }
      await fetchComments();
    } catch {
      toast.error('Failed to update reaction');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {[1, 2].map(i => (
          <div className="flex gap-3" key={i}>
            <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
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
      <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <CommentComposer
          issueId={issueId}
          mentionIssues={mentionIssues}
          mentionUsers={mentionUsers}
          onChange={setNewComment}
          onSubmit={body => submitComment(body)}
          placeholder="Write a comment… (supports **markdown**, @mentions, #issues)"
          submitting={submitting}
          value={newComment}
        />
      </div>
    </div>
  );
}
