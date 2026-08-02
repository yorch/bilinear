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
  testId,
  title,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-14 text-center',
        className,
      )}
      data-testid={testId}
    >
      {icon && (
        <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-brand-border bg-brand-subtle text-brand-subtle-foreground">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <div className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
