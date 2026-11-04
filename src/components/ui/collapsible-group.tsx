'use client';

import { ChevronRight } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface CollapsibleGroupProps {
  children: ReactNode;
  className?: string;
  /** Count rendered after the title. */
  count?: number;
  defaultCollapsed?: boolean;
  title: ReactNode;
}

/**
 * A list section with an uppercase title, a count and a disclosure chevron.
 * The Projects and Cycles lists each hand-rolled this button (inline SVG, no
 * `aria-expanded`); it lives here so the disclosure semantics are written once.
 */
export function CollapsibleGroup({
  children,
  className,
  count,
  defaultCollapsed = false,
  title,
}: CollapsibleGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const regionId = useId();

  return (
    <div className={className}>
      <h3 className="m-0 text-base font-normal">
        <button
          aria-controls={regionId}
          aria-expanded={!collapsed}
          className={cn(
            'flex items-center gap-2 px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground-secondary',
            TOUCH_TARGET,
          )}
          onClick={() => setCollapsed(c => !c)}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn('h-3 w-3 transition-transform', !collapsed && 'rotate-90')}
          />
          {title}
          {count !== undefined && (
            <span className="font-normal text-muted-foreground">{count}</span>
          )}
        </button>
      </h3>
      <div hidden={collapsed} id={regionId}>
        {!collapsed && children}
      </div>
    </div>
  );
}
