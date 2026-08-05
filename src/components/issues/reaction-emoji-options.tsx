import type { ReactionCount } from '@/hooks/use-reaction-counts';
import { QUICK_EMOJIS } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';

interface ReactionEmojiOptionsProps {
  counts: Record<string, ReactionCount>;
  /** Called with the picked emoji and whether the user had already reacted with it. */
  onPick: (emoji: string, reacted: boolean) => void;
}

/**
 * The QUICK_EMOJIS grid rendered inside a reaction `SelectPopover` panel.
 * Shared verbatim by the issue reaction bar and comment cards — the only
 * per-site difference is the `onPick` callback.
 */
export function ReactionEmojiOptions({ counts, onPick }: ReactionEmojiOptionsProps) {
  return (
    <>
      {QUICK_EMOJIS.map(emoji => {
        const info = counts[emoji];
        return (
          <button
            className={cn(
              'rounded px-1 py-0.5 text-sm hover:bg-accent',
              info?.reacted && 'bg-brand-subtle',
            )}
            key={emoji}
            onClick={() => onPick(emoji, info?.reacted ?? false)}
            type="button"
          >
            {emoji}
          </button>
        );
      })}
    </>
  );
}
