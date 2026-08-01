import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** A single call to action — usually a Button. */
  action?: ReactNode;
  className?: string;
  description?: string;
  /** Lucide icon element, rendered inside a tinted glyph tile. */
  icon?: ReactNode;
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
export function EmptyState({ action, className, description, icon, title }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl border border-brand-border bg-brand-subtle text-brand-subtle-foreground">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
