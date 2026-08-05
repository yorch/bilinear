'use client';

import { Smile } from 'lucide-react';
import { ReactionEmojiOptions } from '@/components/issues/reaction-emoji-options';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SelectPopover } from '@/components/ui/select-popover';
import { useReactionCounts } from '@/hooks/use-reaction-counts';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlQuery } from '@/lib/graphql';
import {
  ISSUE_REACTION_ADD_MUTATION,
  ISSUE_REACTION_REMOVE_MUTATION,
  ISSUE_REACTIONS_QUERY,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';

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
      const issue = await gqlQuery<{ reactions: Reaction[] } | null>(
        ISSUE_REACTIONS_QUERY,
        { id: issueId },
        'issue',
      );
      return issue?.reactions ?? [];
    },
    [issueId],
    [],
  );

  const counts = useReactionCounts(reactions, currentUserId);

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
              ? 'bg-brand-subtle text-brand-subtle-foreground'
              : 'bg-muted text-muted-foreground hover:bg-foreground/10',
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
          'rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
          TOUCH_TARGET,
          hasAny ? '' : 'flex items-center gap-1 px-2 text-xs',
        )}
        triggerTitle={t('issueDetail.reactions.addReaction')}
      >
        {close => (
          <ReactionEmojiOptions
            counts={counts}
            onPick={(emoji, reacted) => {
              toggle(emoji, reacted);
              close();
            }}
          />
        )}
      </SelectPopover>
    </div>
  );
}
