'use client';

import {
  CheckCircle,
  CornerDownRight,
  MoreHorizontal,
  Smile,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, formatRelativeTime } from '@/lib/utils';
import { TipTapEditor } from '../editor/tiptap-editor';

interface CommentAuthor {
  id: string;
  displayName: string;
  initials: string;
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
}

interface CommentReaction {
  id: string;
  emoji: string;
  userId: string;
  user: { id: string; displayName: string };
}

interface CommentItem {
  id: string;
  issueId: string;
  body: string;
  bodyData: Record<string, unknown> | null;
  parentId: string | null;
  resolvedAt: string | null;
  editedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: CommentAuthor;
  replies: CommentItem[];
  reactions: CommentReaction[];
  replyCount: number;
}

interface CommentThreadProps {
  issueId: string;
  currentUserId?: string;
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

const QUICK_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🚀', '👀', '😕'];

export function CommentThread({ issueId, currentUserId }: CommentThreadProps) {
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
      await fetchComments();
      toast.success('Comment deleted');
    } catch {
      toast.error('Failed to delete comment');
    }
  };

  const toggleResolve = async (comment: CommentItem) => {
    try {
      if (comment.resolvedAt) {
        await gql(COMMENT_UNRESOLVE_MUTATION, { id: comment.id });
      } else {
        await gql(COMMENT_RESOLVE_MUTATION, { id: comment.id });
      }
      await fetchComments();
    } catch {
      toast.error('Failed to update comment');
    }
  };

  const toggleReaction = async (
    commentId: string,
    emoji: string,
    hasReacted: boolean,
  ) => {
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
          <div key={i} className="flex gap-3">
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
          key={comment.id}
          comment={comment}
          currentUserId={currentUserId}
          onDelete={deleteComment}
          onToggleResolve={toggleResolve}
          onToggleReaction={toggleReaction}
          onReply={id => setShowReplyTo(showReplyTo === id ? null : id)}
          showReplyTo={showReplyTo}
          onSubmitReply={submitComment}
        />
      ))}

      {/* New comment composer */}
      <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
        <CommentComposer
          placeholder="Write a comment… (supports **markdown**)"
          onSubmit={body => submitComment(body)}
          submitting={submitting}
          value={newComment}
          onChange={setNewComment}
        />
      </div>
    </div>
  );
}

function CommentCard({
  comment,
  currentUserId,
  depth = 0,
  onDelete,
  onToggleResolve,
  onToggleReaction,
  onReply,
  showReplyTo,
  onSubmitReply,
}: {
  comment: CommentItem;
  currentUserId?: string;
  depth?: number;
  onDelete: (id: string) => void;
  onToggleResolve: (comment: CommentItem) => void;
  onToggleReaction: (
    commentId: string,
    emoji: string,
    hasReacted: boolean,
  ) => void;
  onReply: (id: string) => void;
  showReplyTo: string | null;
  onSubmitReply: (body: string, parentId?: string) => void;
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

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const saveEdit = async () => {
    if (!editBody.trim() || editBody === comment.body) {
      setEditing(false);
      return;
    }
    try {
      await gql(COMMENT_UPDATE_MUTATION, {
        id: comment.id,
        input: { body: editBody },
      });
      setEditing(false);
    } catch {
      toast.error('Failed to update comment');
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
            <Avatar author={comment.author} size="sm" />
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {comment.author.displayName}
            </span>
            <span className="text-xs text-zinc-400">
              {formatRelativeTime(comment.createdAt)}
            </span>
            {comment.editedAt && (
              <span className="text-xs italic text-zinc-400">(edited)</span>
            )}
            {isResolved && (
              <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle className="h-3 w-3" />
                Resolved
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Emoji reaction */}
            <div ref={emojiRef} className="relative">
              <button
                type="button"
                onClick={() => setShowEmojiPicker(v => !v)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                title="React"
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
              {showEmojiPicker && (
                <div className="absolute right-0 top-6 z-50 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                  {QUICK_EMOJIS.map(emoji => {
                    const info = reactionCounts[emoji];
                    return (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          onToggleReaction(
                            comment.id,
                            emoji,
                            info?.reacted ?? false,
                          );
                          setShowEmojiPicker(false);
                        }}
                        className={cn(
                          'rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700',
                          info?.reacted &&
                            'bg-indigo-100 dark:bg-indigo-900/30',
                        )}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Reply */}
            {depth === 0 && (
              <button
                type="button"
                onClick={() => onReply(comment.id)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                title="Reply"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Resolve */}
            <button
              type="button"
              onClick={() => onToggleResolve(comment)}
              className={cn(
                'rounded p-1 transition-colors',
                isResolved
                  ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20'
                  : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700',
              )}
              title={isResolved ? 'Unresolve' : 'Resolve'}
            >
              <CheckCircle className="h-3.5 w-3.5" />
            </button>

            {/* More menu (edit/delete) */}
            {isOwn && (
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu(v => !v)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-6 z-50 min-w-[120px] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setShowMenu(false);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(comment.id);
                        setShowMenu(false);
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        {editing ? (
          <div className="space-y-2">
            <TipTapEditor
              content={editBody}
              onChange={setEditBody}
              showToolbar
              autofocus
              className="rounded border border-indigo-400 p-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveEdit}
                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: rich text from TipTap, trusted server content
            dangerouslySetInnerHTML={{ __html: comment.body }}
          />
        )}

        {/* Reaction summary */}
        {Object.keys(reactionCounts).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(reactionCounts).map(
              ([emoji, { count, reacted }]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction(comment.id, emoji, reacted)}
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
                    reacted
                      ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                      : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
                  )}
                >
                  <span>{emoji}</span>
                  <span>{count}</span>
                </button>
              ),
            )}
          </div>
        )}
      </div>

      {/* Nested replies */}
      {comment.replies.length > 0 && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
          {comment.replies.map(reply => (
            <CommentCard
              key={reply.id}
              comment={reply}
              currentUserId={currentUserId}
              depth={1}
              onDelete={onDelete}
              onToggleResolve={onToggleResolve}
              onToggleReaction={onToggleReaction}
              onReply={onReply}
              showReplyTo={showReplyTo}
              onSubmitReply={onSubmitReply}
            />
          ))}
        </div>
      )}

      {/* Inline reply composer */}
      {showReplyTo === comment.id && (
        <div className="ml-4 mt-2 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
          <CommentComposer
            placeholder="Reply…"
            onSubmit={body => {
              onSubmitReply(body, comment.id);
              setReplyBody('');
            }}
            submitting={false}
            value={replyBody}
            onChange={setReplyBody}
            compact
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
  compact = false,
}: {
  placeholder: string;
  onSubmit: (body: string) => void;
  submitting: boolean;
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
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
        content={value}
        placeholder={placeholder}
        onChange={onChange}
        showToolbar={!compact}
        className={cn('text-sm', compact ? 'min-h-[40px]' : 'min-h-[80px]')}
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onSubmit(value)}
          disabled={isEmpty || submitting}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors',
            'bg-indigo-600 hover:bg-indigo-700',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {submitting ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

function Avatar({
  author,
  size = 'md',
}: {
  author: CommentAuthor;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-xs';
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        dim,
      )}
      style={{ backgroundColor: author.avatarBackgroundColor }}
      title={author.displayName}
    >
      {author.initials}
    </span>
  );
}
