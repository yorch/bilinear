'use client';

import { CheckCircle, CornerDownRight, MoreHorizontal, Smile } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { usePopover } from '@/hooks/use-popover';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { COMMENT_UPDATE_MUTATION, CONVERT_TO_SUB_ISSUE_MUTATION } from '@/lib/graphql-queries';
import { QUICK_EMOJIS } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { MentionItem } from '../editor/mention-list';
import { TipTapEditor } from '../editor/tiptap-editor.lazy';
import { UserAvatar } from '../ui/user-avatar';
import { CommentComposer } from './comment-composer';

export interface CommentAuthor {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  id: string;
  initials: string;
}

export interface CommentReaction {
  emoji: string;
  id: string;
  user: { id: string; displayName: string };
  userId: string;
}

export interface CommentItem {
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

export function CommentCard({
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
  onSubmitReply: (body: string, parentId?: string) => void | Promise<void>;
  onUpdate: (comment: CommentItem) => void;
  onConvertToSubIssue: (id: string) => void;
}) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);
  const { open: showMenu, setOpen: setShowMenu, ref: menuRef } = usePopover();
  const { open: showEmojiPicker, setOpen: setShowEmojiPicker, ref: emojiRef } = usePopover();

  const isOwn = comment.author.id === currentUserId;
  const isResolved = !!comment.resolvedAt;

  const reactionCounts = useMemo(
    () =>
      comment.reactions.reduce<Record<string, { count: number; reacted: boolean }>>((acc, r) => {
        if (!acc[r.emoji]) {
          acc[r.emoji] = { count: 0, reacted: false };
        }
        acc[r.emoji].count++;
        if (r.userId === currentUserId) {
          acc[r.emoji].reacted = true;
        }
        return acc;
      }, {}),
    [comment.reactions, currentUserId],
  );

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
      toast.error(t('issueDetail.comments.failedToUpdate'));
    }
  };

  const handleQuoteReply = () => {
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
      toast.error(t('issueDetail.comments.cannotConvertTeamUnresolved'));
      return;
    }
    const text = new DOMParser().parseFromString(comment.body, 'text/html').body.textContent ?? '';
    const title = text.trim().slice(0, 255) || t('issueDetail.comments.subIssueFromComment');
    try {
      await gql(CONVERT_TO_SUB_ISSUE_MUTATION, {
        input: {
          description: comment.body,
          parentId: issueId,
          teamId,
          title,
        },
      });
      toast.success(t('issueDetail.comments.convertedToSubIssue'));
      onConvertToSubIssue(comment.id);
    } catch {
      toast.error(t('issueDetail.comments.failedToConvert'));
    }
  };

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
            {comment.editedAt && (
              <span className="text-xs italic text-zinc-400">
                ({t('issueDetail.comments.edited')})
              </span>
            )}
            {isResolved && (
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle className="h-3 w-3" />
                {t('issueDetail.comments.resolved')}
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
            {/* Emoji reaction */}
            <div className="relative" ref={emojiRef}>
              <button
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700"
                onClick={() => setShowEmojiPicker(v => !v)}
                title={t('issueDetail.comments.react')}
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
                title={t('issueDetail.comments.quoteReply')}
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
              title={
                isResolved ? t('issueDetail.comments.unresolve') : t('issueDetail.comments.resolve')
              }
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
                      {t('common.edit')}
                    </button>
                  )}
                  {/* Convert to sub-issue — only on top-level comments */}
                  {depth === 0 && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      onClick={handleConvertToSubIssue}
                      type="button"
                    >
                      {t('issueDetail.comments.convertToSubIssue')}
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
                      {t('common.delete')}
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
                {t('common.save')}
              </button>
              <button
                className="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700"
                onClick={() => setEditing(false)}
                type="button"
              >
                {t('common.cancel')}
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
            onSubmit={async body => {
              setReplySubmitting(true);
              try {
                await onSubmitReply(body, comment.id);
              } finally {
                setReplySubmitting(false);
                setReplyBody('');
              }
            }}
            placeholder={t('issueDetail.comments.replyPlaceholder')}
            submitting={replySubmitting}
            value={replyBody}
          />
        </div>
      )}
    </div>
  );
}
