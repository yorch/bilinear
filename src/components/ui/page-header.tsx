import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';

interface PageHeaderProps {
  /** Right-aligned controls (view toggles, primary actions). */
  actions?: ReactNode;
  /** Optional count rendered as a pill next to the title. */
  count?: number;
  /** Sub-line under the title, for pages that need to explain themselves. */
  description?: string;
  /** Rendered before the title — a back button, team icon or breadcrumb. */
  leading?: ReactNode;
  title: ReactNode;
}

/**
 * The single page-chrome header.
 *
 * Every route used to hand-roll this, and they had drifted into four
 * different paddings — `h-12 px-4`, `px-6 py-3`, `px-4 py-2` and `px-6 py-4`
 * — across sibling pages, so the chrome visibly shifted as you navigated.
 *
 * `min-h-12` rather than a fixed height: the actions area wraps below `sm`
 * (see the mobile pass), and a fixed height would clip the wrapped row.
 */
export function PageHeader({ actions, count, description, leading, title }: PageHeaderProps) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {count !== undefined && <Badge tone="muted">{count}</Badge>}
          </div>
          {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Secondary control strip directly under a PageHeader — filters, grouping,
 * display options. Visually lighter than the header it sits below.
 */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-1.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
