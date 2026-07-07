'use client';

import { Smile } from 'lucide-react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SelectPopover } from '@/components/ui/select-popover';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import {
  ISSUE_REACTION_ADD_MUTATION,
  ISSUE_REACTION_REMOVE_MUTATION,
  ISSUE_REACTIONS_QUERY,
} from '@/lib/graphql-queries';
import { QUICK_EMOJIS } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface Reaction {
  emoji: string;
  id: string;
  user: { id: string; displayName: string };
  userId: string;
}

interface IssueReactionBarProps {
  currentUserId: string | undefined;
  issueId: string;
}

export function IssueReactionBar({ issueId, currentUserId }: IssueReactionBarProps) {
  const t = useTranslations();
  const {
    data: reactions,
    error: loadError,
    refetch: fetchReactions,
  } = useRetryableFetch<Reaction[]>(
    async () => {
      const res = await gql(ISSUE_REACTIONS_QUERY, { id: issueId });
      const data = res.data as { issue?: { reactions: Reaction[] } } | undefined;
      return data?.issue?.reactions ?? [];
    },
    [issueId],
    [],
  );

  const counts = reactions.reduce<Record<string, { count: number; reacted: boolean }>>((acc, r) => {
    if (!acc[r.emoji]) {
      acc[r.emoji] = { count: 0, reacted: false };
    }
    acc[r.emoji].count++;
    if (r.userId === currentUserId) {
      acc[r.emoji].reacted = true;
    }
    return acc;
  }, {});

  const toggle = async (emoji: string, hasReacted: boolean) => {
    try {
      const res = hasReacted
        ? await gql(ISSUE_REACTION_REMOVE_MUTATION, { emoji, issueId })
        : await gql(ISSUE_REACTION_ADD_MUTATION, { emoji, issueId });
      if (res.errors?.length) {
        throw new Error(t('common.somethingWentWrong'));
      }
      await fetchReactions({ silent: true });
    } catch {
      toast.error(t('issueDetail.reactions.failedToUpdate'));
    }
  };

  const hasAny = Object.keys(counts).length > 0;

  if (loadError && !hasAny) {
    return (
      <InlineRetry
        className="py-0"
        message={t('issueDetail.reactions.failedToLoad')}
        onRetry={fetchReactions}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {Object.entries(counts).map(([emoji, { count, reacted }]) => (
        <button
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
            reacted
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
              : 'bg-muted text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-700',
          )}
          key={emoji}
          onClick={() => toggle(emoji, reacted)}
          type="button"
        >
          <span>{emoji}</span>
          <span>{count}</span>
        </button>
      ))}
      <SelectPopover
        panelClassName="flex gap-1 p-1.5"
        triggerChildren={
          <>
            <Smile className="h-3.5 w-3.5" />
            {!hasAny && <span>{t('issueDetail.reactions.react')}</span>}
          </>
        }
        triggerClassName={cn(
          'rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700',
          hasAny ? '' : 'flex items-center gap-1 px-2 text-xs',
        )}
        triggerTitle={t('issueDetail.reactions.addReaction')}
      >
        {close => (
          <>
            {QUICK_EMOJIS.map(emoji => {
              const info = counts[emoji];
              return (
                <button
                  className={cn(
                    'rounded px-1 py-0.5 text-sm hover:bg-accent',
                    info?.reacted && 'bg-indigo-100 dark:bg-indigo-900/30',
                  )}
                  key={emoji}
                  onClick={() => {
                    toggle(emoji, info?.reacted ?? false);
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
    </div>
  );
}
