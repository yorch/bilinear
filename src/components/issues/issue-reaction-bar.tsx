'use client';

import { Smile } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gql } from '@/lib/graphql';
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

const QUICK_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🚀', '👀', '😕'];

const GET_REACTIONS_QUERY = `
  query IssueReactions($id: ID!) {
    issue(id: $id) {
      id
      reactions { id emoji userId user { id displayName } }
    }
  }
`;

const REACTION_ADD_MUTATION = `
  mutation IssueReactionAdd($issueId: ID!, $emoji: String!) {
    issueReactionAdd(issueId: $issueId, emoji: $emoji) {
      success
      reaction { id emoji userId user { id displayName } }
    }
  }
`;

const REACTION_REMOVE_MUTATION = `
  mutation IssueReactionRemove($issueId: ID!, $emoji: String!) {
    issueReactionRemove(issueId: $issueId, emoji: $emoji) { success }
  }
`;

export function IssueReactionBar({ issueId, currentUserId }: IssueReactionBarProps) {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const fetchReactions = useCallback(async () => {
    try {
      const res = await gql(GET_REACTIONS_QUERY, { id: issueId });
      const data = res.data as { issue?: { reactions: Reaction[] } } | undefined;
      setReactions(data?.issue?.reactions ?? []);
    } catch {
      // Non-fatal — bar just stays empty
    }
  }, [issueId]);

  useEffect(() => {
    fetchReactions();
  }, [fetchReactions]);

  // Close the picker on outside click
  useEffect(() => {
    if (!showPicker) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [showPicker]);

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
        ? await gql(REACTION_REMOVE_MUTATION, { emoji, issueId })
        : await gql(REACTION_ADD_MUTATION, { emoji, issueId });
      if (res.errors?.length) {
        throw new Error('mutation failed');
      }
      await fetchReactions();
    } catch {
      toast.error('Failed to update reaction');
    }
  };

  const hasAny = Object.keys(counts).length > 0;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {Object.entries(counts).map(([emoji, { count, reacted }]) => (
        <button
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors',
            reacted
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
          )}
          key={emoji}
          onClick={() => toggle(emoji, reacted)}
          type="button"
        >
          <span>{emoji}</span>
          <span>{count}</span>
        </button>
      ))}
      <div className="relative" ref={pickerRef}>
        <button
          className={cn(
            'rounded-full p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-700',
            hasAny ? '' : 'flex items-center gap-1 px-2 text-xs',
          )}
          onClick={() => setShowPicker(v => !v)}
          title="Add reaction"
          type="button"
        >
          <Smile className="h-3.5 w-3.5" />
          {!hasAny && <span>React</span>}
        </button>
        {showPicker && (
          <div className="absolute left-0 top-7 z-50 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800">
            {QUICK_EMOJIS.map(emoji => {
              const info = counts[emoji];
              return (
                <button
                  className={cn(
                    'rounded px-1 py-0.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700',
                    info?.reacted && 'bg-indigo-100 dark:bg-indigo-900/30',
                  )}
                  key={emoji}
                  onClick={() => {
                    toggle(emoji, info?.reacted ?? false);
                    setShowPicker(false);
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
    </div>
  );
}
