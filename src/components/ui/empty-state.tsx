import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** A single call to action — usually a Button. */
  action?: ReactNode;
  className?: string;
  /** ReactNode, not string: some empty states inline a `<kbd>` shortcut hint. */
  description?: ReactNode;
  /** Lucide icon element, rendered inside a tinted glyph tile. */
  icon?: ReactNode;
  /**
   * `compact` is the sub-section variant — a dashed inset inside a card or
   * under a section header, where the full-page padding and glyph tile would
   * dwarf the content around it. Sub-sections used to hand-roll this as a
   * dashed `<div>` or a bare `<p>`, each with its own padding.
   */
  size?: 'compact' | 'default';
  /** Forwarded to the root, for the e2e specs that wait on an empty list. */
  testId?: string;
  title: string;
}

/**
 * Shared "there is nothing here yet" state.
 *
 * Pages previously rendered a bare centred string, which reads as a failure
 * rather than a starting point. The tinted glyph tile is one of the few
 * places the brand gradient is allowed outside the chrome, because there is
 * no data on screen to compete with it.
 */
export function EmptyState({
  action,
  className,
  description,
  icon,
  size = 'default',
  testId,
  title,
}: EmptyStateProps) {
  const compact = size === 'compact';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact
          ? 'gap-1 rounded-md border border-dashed border-border px-4 py-8'
          : 'gap-2 px-6 py-14',
        className,
      )}
      data-testid={testId}
    >
      {icon && !compact && (
        <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-brand-border bg-brand-subtle text-brand-subtle-foreground">
          {icon}
        </span>
      )}
      <p
        className={cn(
          'text-sm',
          compact ? 'font-medium text-muted-foreground' : 'font-semibold text-foreground',
        )}
      >
        {title}
      </p>
      {description && (
        <div className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
