import { cn } from '@/lib/utils';

/**
 * The little key cap shown on a triage action button. Decorative
 * (`aria-hidden`) — the button carries `aria-keyshortcuts` instead, so the
 * accessible name stays "Accept", not "Accept 1". Hidden where there is no
 * physical keyboard to press it on, matching the queue's footer legend.
 */
export function TriageKeyHint({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        'rounded border border-current px-1 font-mono text-[10px] leading-4 opacity-60 max-md:hidden [@media(hover:none)]:hidden',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
