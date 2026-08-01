'use client';

import { CheckCircle, CornerDownRight, MoreHorizontal, Smile } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { SelectPopover } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate } from '@/lib/graphql';
import { COMMENT_UPDATE_MUTATION, CONVERT_TO_SUB_ISSUE_MUTATION } from '@/lib/graphql-queries';
import { QUICK_EMOJIS } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';
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
  /** Resolves `false` when the reply was rejected — the composer then keeps the body. */
  onSubmitReply: (
    body: string,
    parentId?: string,
  ) => boolean | undefined | Promise<boolean | undefined>;
  onUpdate: (comment: CommentItem) => void;
  onConvertToSubIssue: (id: string) => void;
}) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

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
      // gqlMutate throws on a rejected edit, so the editor stays open with the
      // user's text intact instead of closing and snapping back to the old body.
      const data = await gqlMutate(COMMENT_UPDATE_MUTATION, {
        id: comment.id,
        input: { body: editBody },
      });
      const updated = (data as { commentUpdate?: { comment: CommentItem } }).commentUpdate?.comment;
      if (updated) {
        onUpdate(updated);
      }
      setEditing(false);
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.comments.failedToUpdate')));
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
    if (!teamId) {
      toast.error(t('issueDetail.comments.cannotConvertTeamUnresolved'));
      return;
    }
    const text = new DOMParser().parseFromString(comment.body, 'text/html').body.textContent ?? '';
    const title = text.trim().slice(0, 255) || t('issueDetail.comments.subIssueFromComment');
    try {
      // Must throw on rejection: `onConvertToSubIssue` removes the comment from
      // the thread, so an unchecked failure made it vanish with no sub-issue.
      await gqlMutate(CONVERT_TO_SUB_ISSUE_MUTATION, {
        input: {
          description: comment.body,
          parentId: issueId,
          teamId,
          title,
        },
      });
      toast.success(t('issueDetail.comments.convertedToSubIssue'));
      onConvertToSubIssue(comment.id);
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.comments.failedToConvert')));
    }
  };

  return (
    <div className={cn('group relative', depth > 0 && 'ml-8 mt-2')}>
      <div
        className={cn(
          'rounded-lg p-3 transition-colors',
          isResolved
            ? 'bg-muted opacity-70 dark:bg-muted/30'
            : 'bg-muted/50 hover:bg-muted dark:bg-muted/20 dark:hover:bg-muted/40',
        )}
      >
        {/* Header */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <UserAvatar size="md" user={comment.author} />
            <span className="text-xs font-medium text-foreground-secondary">
              {comment.author.displayName}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(comment.createdAt)}
            </span>
            {comment.editedAt && (
              <span className="text-xs italic text-muted-foreground">
                ({t('issueDetail.comments.edited')})
              </span>
            )}
            {isResolved && (
              <Badge className="bg-success-subtle text-success-subtle-foreground">
                <CheckCircle className="h-3 w-3" />
                {t('issueDetail.comments.resolved')}
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100 transition-opacity">
            {/* Emoji reaction */}
            <SelectPopover
              align="right"
              panelClassName="flex gap-1 p-1.5"
              triggerChildren={<Smile className="h-3.5 w-3.5" />}
              triggerClassName="p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
              triggerTitle={t('issueDetail.comments.react')}
            >
              {close => (
                <>
                  {QUICK_EMOJIS.map(emoji => {
                    const info = reactionCounts[emoji];
                    return (
                      <button
                        className={cn(
                          'rounded px-1 py-0.5 text-sm hover:bg-accent',
                          info?.reacted && 'bg-brand-subtle',
                        )}
                        key={emoji}
                        onClick={() => {
                          onToggleReaction(comment.id, emoji, info?.reacted ?? false);
                          close();
                        }}
                        type="button"
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </>
              )}
            </SelectPopover>

            {/* Quote reply */}
            {depth === 0 && (
              <button
                aria-label={t('issueDetail.comments.quoteReply')}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                onClick={handleQuoteReply}
                title={t('issueDetail.comments.quoteReply')}
                type="button"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Resolve */}
            <button
              aria-label={
                isResolved ? t('issueDetail.comments.unresolve') : t('issueDetail.comments.resolve')
              }
              className={cn(
                'rounded p-1 transition-colors max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center',
                isResolved
                  ? 'text-success-subtle-foreground hover:bg-success-subtle dark:hover:bg-success-subtle/20'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
            <SelectPopover
              align="right"
              panelClassName="min-w-[160px] py-1"
              triggerChildren={<MoreHorizontal className="h-3.5 w-3.5" />}
              triggerClassName="p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
            >
              {close => (
                <>
                  {isOwn && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-foreground-secondary hover:bg-muted"
                      onClick={() => {
                        setEditing(true);
                        close();
                      }}
                      type="button"
                    >
                      {t('common.edit')}
                    </button>
                  )}
                  {/* Convert to sub-issue — only on top-level comments */}
                  {depth === 0 && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-foreground-secondary hover:bg-muted"
                      onClick={() => {
                        handleConvertToSubIssue();
                        close();
                      }}
                      type="button"
                    >
                      {t('issueDetail.comments.convertToSubIssue')}
                    </button>
                  )}
                  {isOwn && (
                    <button
                      className="w-full px-3 py-1.5 text-left text-xs text-danger-subtle-foreground hover:bg-danger-subtle dark:hover:bg-danger-subtle/20"
                      onClick={() => {
                        onDelete(comment.id);
                        close();
                      }}
                      type="button"
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </>
              )}
            </SelectPopover>
          </div>
        </div>

        {/* Body */}
        {editing ? (
          <div className="space-y-2">
            <TipTapEditor
              autofocus
              className="rounded border border-brand p-1 text-sm"
              content={editBody}
              onChange={setEditBody}
              showToolbar
              uploadIssueId={issueId}
            />
            <div className="flex gap-2">
              <button
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/90"
                onClick={saveEdit}
                type="button"
              >
                {t('common.save')}
              </button>
              <button
                className="rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => setEditing(false)}
                type="button"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <TipTapEditor
            className="prose prose-sm dark:prose-invert max-w-none text-foreground-secondary"
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
                    ? 'bg-brand-subtle text-brand-subtle-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent',
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

      {/* Nested replies. Threads are one level deep (enforced server-side), and
          `COMMENTS_FRAGMENT` only selects `{ id }` at the third level — so a
          depth-1 card must not recurse, or it would mount a card for a stub
          with no `author`/`reactions` and crash on `comment.author.id`. */}
      {depth === 0 && comment.replies.length > 0 && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-border pl-4">
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
        <div className="ml-4 mt-2 border-l-2 border-border pl-4">
          <CommentComposer
            compact
            issueId={issueId}
            mentionIssues={mentionIssues}
            mentionUsers={mentionUsers}
            onChange={setReplyBody}
            onSubmit={async body => {
              setReplySubmitting(true);
              try {
                const ok = await onSubmitReply(body, comment.id);
                if (ok !== false) {
                  setReplyBody('');
                }
              } finally {
                setReplySubmitting(false);
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
