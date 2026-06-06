'use client';

import { CheckCircle, CornerDownRight, MoreHorizontal, Smile } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { MentionItem } from '../editor/mention-list';
import { TipTapEditor } from '../editor/tiptap-editor.lazy';
import { UserAvatar } from '../ui/user-avatar';

interface CommentAuthor {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  id: string;
  initials: string;
}

interface CommentReaction {
  emoji: string;
  id: string;
  user: { id: string; displayName: string };
  userId: string;
}

interface CommentItem {
  author: CommentAuthor;
  body: string;
  bodyData: Record<string, unknown> | null;
  createdAt: string;
  editedAt: string | null;
  id: string;
  issueId: string;
  parentId: string | null;
  reactions: CommentReaction[];
  replies: CommentItem[];
  replyCount: number;
  resolvedAt: string | null;
  updatedAt: string;
}

interface CommentThreadProps {
  currentUserId?: string;
  issueId: string;
  mentionIssues?: MentionItem[];
  mentionUsers?: MentionItem[];
  teamId?: string;
}

const COMMENTS_FRAGMENT = `
  id issueId body bodyData parentId resolvedAt editedAt createdAt updatedAt
  author { id displayName initials avatarBackgroundColor avatarUrl }
  reactions { id emoji userId user { id displayName } }
  replyCount
  replies {
    id issueId body bodyData parentId resolvedAt editedAt createdAt updatedAt
    author { id displayName initials avatarBackgroundColor avatarUrl }
    reactions { id emoji userId user { id displayName } }
    replyCount
    replies { id }
  }
`;

const GET_COMMENTS_QUERY = `
  query GetComments($issueId: ID!) {
    comments(issueId: $issueId) { ${COMMENTS_FRAGMENT} }
  }
`;

const COMMENT_CREATE_MUTATION = `
  mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success lastSyncId
      comment { ${COMMENTS_FRAGMENT} }
    }
  }
`;

const COMMENT_UPDATE_MUTATION = `
  mutation CommentUpdate($id: ID!, $input: CommentUpdateInput!) {
    commentUpdate(id: $id, input: $input) {
      success
      comment { ${COMMENTS_FRAGMENT} }
    }
  }
`;

const COMMENT_DELETE_MUTATION = `
  mutation CommentDelete($id: ID!) {
    commentDelete(id: $id) { success }
  }
`;

const COMMENT_RESOLVE_MUTATION = `
  mutation CommentResolve($id: ID!) {
    commentResolve(id: $id) {
      success
      comment { id resolvedAt }
    }
  }
`;

const COMMENT_UNRESOLVE_MUTATION = `
  mutation CommentUnresolve($id: ID!) {
    commentUnresolve(id: $id) {
      success
      comment { id resolvedAt }
    }
  }
`;

const REACTION_ADD_MUTATION = `
  mutation ReactionAdd($commentId: ID!, $emoji: String!) {
    commentReactionAdd(commentId: $commentId, emoji: $emoji) {
      success
      reaction { id emoji userId user { id displayName } }
    }
  }
`;

const REACTION_REMOVE_MUTATION = `
  mutation ReactionRemove($commentId: ID!, $emoji: String!) {
    commentReactionRemove(commentId: $commentId, emoji: $emoji) { success }
  }
`;

const CONVERT_TO_SUB_ISSUE_MUTATION = `
  mutation ConvertCommentToSubIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success lastSyncId
      issue { id title identifier }
    }
  }
`;

const QUICK_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🚀', '👀', '😕'];

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
        await gql(REACTION_REMOVE_MUTATION, { commentId, emoji });
      } else {
        await gql(REACTION_ADD_MUTATION, { commentId, emoji });
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
      <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
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

function CommentCard({
  comment,
  currentUserId,
  mentionIssues,
  mentionUsers,
  issueId,
  teamId,
  depth = 0,
  onDelete,
  onToggleResolve,
  onToggleReaction,
  onReply,
  showReplyTo,
  onSubmitReply,
  onUpdate,
  onConvertToSubIssue,
}: {
  comment: CommentItem;
  currentUserId?: string;
  mentionIssues?: MentionItem[];
  mentionUsers?: MentionItem[];
  issueId: string;
  teamId?: string;
  depth?: number;
  onDelete: (id: string) => void;
  onToggleResolve: (comment: CommentItem) => void;
  onToggleReaction: (commentId: string, emoji: string, hasReacted: boolean) => void;
  onReply: (id: string) => void;
  showReplyTo: string | null;
  onSubmitReply: (body: string, parentId?: string) => void;
  onUpdate: (comment: CommentItem) => void;
  onConvertToSubIssue: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [showMenu, setShowMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  const isOwn = comment.author.id === currentUserId;
  const isResolved = !!comment.resolvedAt;

  useOutsideClick(menuRef, () => setShowMenu(false), showMenu);
  useOutsideClick(emojiRef, () => setShowEmojiPicker(false), showEmojiPicker);

  const saveEdit = async () => {
    if (!editBody.trim() || editBody === comment.body) {
      setEditing(false);
      return;
    }
    try {
      const res = await gql(COMMENT_UPDATE_MUTATION, {
        id: comment.id,
        input: { body: editBody },
      });
      const updated = (res.data as { commentUpdate?: { comment: CommentItem } } | undefined)
        ?.commentUpdate?.comment;
      if (updated) {
        onUpdate(updated);
      }
      setEditing(false);
    } catch {
      toast.error('Failed to update comment');
    }
  };

  const handleQuoteReply = () => {
    // Wrap the comment body in a <blockquote> for the reply composer
    const quoted = `<blockquote>${comment.body}</blockquote><p></p>`;
    onReply(comment.id);
    // Use a microtask so the reply box is mounted before we set its content
    setTimeout(() => {
      setReplyBody(quoted);
    }, 50);
  };

  const handleConvertToSubIssue = async () => {
    setShowMenu(false);
    if (!teamId) {
      toast.error('Cannot convert — team not resolved');
      return;
    }
    const text = new DOMParser().parseFromString(comment.body, 'text/html').body.textContent ?? '';
    const title = text.trim().slice(0, 255) || 'Sub-issue from comment';
    try {
      await gql(CONVERT_TO_SUB_ISSUE_MUTATION, {
        input: {
          description: comment.body,
          parentId: issueId,
          teamId,
          title,
        },
      });
      toast.success('Converted to sub-issue');
      onConvertToSubIssue(comment.id);
    } catch {
      toast.error('Failed to convert comment to sub-issue');
    }
  };

  const reactionCounts = comment.reactions.reduce<
    Record<string, { count: number; reacted: boolean }>
  >((acc, r) => {
    if (!acc[r.emoji]) {
      acc[r.emoji] = { count: 0, reacted: false };
    }
    acc[r.emoji].count++;
    if (r.userId === currentUserId) {
      acc[r.emoji].reacted = true;
    }
    return acc;
  }, {});

  return (
    <div className={cn('group relative', depth > 0 && 'ml-8 mt-2')}>
      <div
        className={cn(
          'rounded-lg p-3 transition-colors',
          isResolved
            ? 'bg-zinc-50 opacity-70 dark:bg-zinc-800/30'
            : 'bg-zinc-50/50 hover:bg-zinc-50 dark:bg-zinc-800/20 dark:hover:bg-zinc-800/40',
        )}
      >
        {/* Header */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserAvatar size="md" user={comment.author} />
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {comment.author.displayName}
            </span>
            <span className="text-xs text-zinc-400">{formatRelativeTime(comment.createdAt)}</span>
            {comment.editedAt && <span className="text-xs italic text-zinc-400">(edited)</span>}
            {isResolved && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle className="h-3 w-3" />
                Resolved
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Emoji reaction */}
            <div className="relative" ref={emojiRef}>
              <button
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                onClick={() => setShowEmojiPicker(v => !v)}
                title="React"
                type="button"
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
              {showEmojiPicker && (
                <div className="absolute right-0 top-6 z-50 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                  {QUICK_EMOJIS.map(emoji => {
                    const info = reactionCounts[emoji];
                    return (
                      <button
                        className={cn(
                          'rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700',
                          info?.reacted && 'bg-indigo-100 dark:bg-indigo-900/30',
                        )}
                        key={emoji}
                        onClick={() => {
                          onToggleReaction(comment.id, emoji, info?.reacted ?? false);
                          setShowEmojiPicker(false);
                        }}
                        type="button"
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Quote reply */}
            {depth === 0 && (
              <button
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                onClick={handleQuoteReply}
                title="Quote reply"
                type="button"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Resolve */}
            <button
              className={cn(
                'rounded p-1 transition-colors',
                isResolved
                  ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20'
                  : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700',
              )}
              onClick={() => onToggleResolve(comment)}
              title={isResolved ? 'Unresolve' : 'Resolve'}
              type="button"
            >
              <CheckCircle className="h-3.5 w-3.5" />
            </button>

            {/* More menu (edit/delete/convert) */}
            <div className="relative" ref={menuRef}>
              <button
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                onClick={() => setShowMenu(v => !v)}
                type="button"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-6 z-50 min-w-[160px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                  {isOwn && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      onClick={() => {
                        setEditing(true);
                        setShowMenu(false);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                  )}
                  {/* Convert to sub-issue — only on top-level comments */}
                  {depth === 0 && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      onClick={handleConvertToSubIssue}
                      type="button"
                    >
                      Convert to sub-issue
                    </button>
                  )}
                  {isOwn && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                      onClick={() => {
                        onDelete(comment.id);
                        setShowMenu(false);
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        {editing ? (
          <div className="space-y-2">
            <TipTapEditor
              autofocus
              className="rounded border border-indigo-400 p-1 text-sm"
              content={editBody}
              onChange={setEditBody}
              showToolbar
              uploadIssueId={issueId}
            />
            <div className="flex gap-2">
              <button
                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
                onClick={saveEdit}
                type="button"
              >
                Save
              </button>
              <button
                className="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                onClick={() => setEditing(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <TipTapEditor
            className="prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300"
            content={comment.body}
            readOnly
          />
        )}

        {/* Reaction summary */}
        {Object.keys(reactionCounts).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(reactionCounts).map(([emoji, { count, reacted }]) => (
              <button
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
                  reacted
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                )}
                key={emoji}
                onClick={() => onToggleReaction(comment.id, emoji, reacted)}
                type="button"
              >
                <span>{emoji}</span>
                <span>{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nested replies */}
      {comment.replies.length > 0 && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
          {comment.replies.map(reply => (
            <CommentCard
              comment={reply}
              currentUserId={currentUserId}
              depth={1}
              issueId={issueId}
              key={reply.id}
              mentionIssues={mentionIssues}
              mentionUsers={mentionUsers}
              onConvertToSubIssue={onConvertToSubIssue}
              onDelete={onDelete}
              onReply={onReply}
              onSubmitReply={onSubmitReply}
              onToggleReaction={onToggleReaction}
              onToggleResolve={onToggleResolve}
              onUpdate={onUpdate}
              showReplyTo={showReplyTo}
              teamId={teamId}
            />
          ))}
        </div>
      )}

      {/* Inline reply composer */}
      {showReplyTo === comment.id && (
        <div className="ml-4 mt-2 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
          <CommentComposer
            compact
            issueId={issueId}
            mentionIssues={mentionIssues}
            mentionUsers={mentionUsers}
            onChange={setReplyBody}
            onSubmit={body => {
              onSubmitReply(body, comment.id);
              setReplyBody('');
            }}
            placeholder="Reply…"
            submitting={false}
            value={replyBody}
          />
        </div>
      )}
    </div>
  );
}

function CommentComposer({
  placeholder,
  onSubmit,
  submitting,
  value,
  onChange,
  mentionIssues,
  mentionUsers,
  compact = false,
  issueId,
}: {
  placeholder: string;
  onSubmit: (body: string) => void;
  submitting: boolean;
  value: string;
  onChange: (v: string) => void;
  mentionIssues?: MentionItem[];
  mentionUsers?: MentionItem[];
  compact?: boolean;
  issueId?: string;
}) {
  const isEmpty = !value || value === '<p></p>' || value.trim() === '';

  return (
    <div
      className={cn(
        'rounded-lg border border-zinc-200 dark:border-zinc-700',
        compact ? 'p-2' : 'p-3',
      )}
    >
      <TipTapEditor
        className={cn('text-sm', compact ? 'min-h-[40px]' : 'min-h-[80px]')}
        content={value}
        mentionIssues={mentionIssues}
        mentionUsers={mentionUsers}
        onChange={onChange}
        placeholder={placeholder}
        showToolbar={!compact}
        uploadIssueId={issueId}
      />
      <div className="mt-2 flex justify-end">
        <button
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors',
            'bg-indigo-600 hover:bg-indigo-700',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
          disabled={isEmpty || submitting}
          onClick={() => onSubmit(value)}
          type="button"
        >
          {submitting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
