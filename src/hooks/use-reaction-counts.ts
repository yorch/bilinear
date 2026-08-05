import { useMemo } from 'react';

interface ReactionLike {
  emoji: string;
  userId: string;
}

export interface ReactionCount {
  count: number;
  reacted: boolean;
}

/**
 * Aggregate a flat reaction list into per-emoji `{ count, reacted }` entries,
 * where `reacted` is true when the current user is among the reactors. Shared
 * by the issue reaction bar and comment cards.
 */
export function useReactionCounts(
  reactions: ReactionLike[],
  currentUserId: string | undefined,
): Record<string, ReactionCount> {
  return useMemo(
    () =>
      reactions.reduce<Record<string, ReactionCount>>((acc, r) => {
        if (!acc[r.emoji]) {
          acc[r.emoji] = { count: 0, reacted: false };
        }
        acc[r.emoji].count++;
        if (r.userId === currentUserId) {
          acc[r.emoji].reacted = true;
        }
        return acc;
      }, {}),
    [reactions, currentUserId],
  );
}
