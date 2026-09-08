'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The "unset" rendering for an inline property picker.
 *
 * Every picker used to render the property's own NAME as its value when nothing
 * was set — "Labels", "Cycle", "Project", "Due date" — so a six-row issue list
 * carried eighteen words that told the reader nothing, and the detail panel
 * printed each field's label twice (once as the row label, once as the value).
 * An unset property now shows a faint icon and no text.
 *
 * The icon stays in the layout rather than rendering `null` because the cell is
 * still the only way to *set* the property by pointer: collapsing it to nothing
 * would leave a dead zone where the affordance used to be.
 *
 * Callers that want the icon hidden until the surrounding row is hovered mark
 * the container instead of passing a prop — see `IssueRow`'s
 * `[&_[data-prop-empty]]` rules. Keeping that decision in the container means
 * the pickers stay identical on a form and in a dense list.
 */
export function PropertyPlaceholder({
  className,
  icon: Icon,
}: {
  className?: string;
  icon: LucideIcon;
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn('h-3.5 w-3.5 text-foreground-faint transition-opacity', className)}
      data-prop-empty=""
    />
  );
}
