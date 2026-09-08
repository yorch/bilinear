import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  /** Optional right-aligned control, e.g. a <SectionAddButton />. */
  action?: ReactNode;
  /** Heading level to render, for document-outline correctness. Defaults to h3. */
  as?: 'h2' | 'h3' | 'h4';
  /**
   * Current collapsed state. Pass together with `onToggle` to render the
   * heading as a disclosure button with a chevron.
   */
  collapsed?: boolean;
  /** Item count rendered after the title. Omitted when undefined, not when 0. */
  count?: number;
  /** Extra content between the heading and the action, e.g. a progress bar. */
  meta?: ReactNode;
  onToggle?: () => void;
  /** Heading content — usually a plain string. */
  title: ReactNode;
}

const HEADING_CLASS = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground';

/**
 * The one subsection header.
 *
 * Every issue-detail section used to roll its own: sub-issues had an uppercase
 * disclosure button with a count, relations used this component without a
 * chevron, attachments and custom fields used a sentence-case `<p>`, and pull
 * requests an `<h3>` — four treatments visible on one screen. Collapsibility
 * and the count are options here so that adopting the primitive never costs a
 * section a feature it already had.
 */
export function SectionHeader({
  title,
  action,
  as = 'h3',
  collapsed,
  count,
  meta,
  onToggle,
}: SectionHeaderProps) {
  const Heading = as;
  const label = (
    <>
      {title}
      {/* A literal space, not just the margin: without it the accessible name
          of the heading is "Sub-issues0". */}
      {count !== undefined && (
        <>
          {' '}
          <span className="ml-1 font-normal tabular-nums text-foreground-faint">{count}</span>
        </>
      )}
    </>
  );

  return (
    <div className="flex items-center justify-between gap-2">
      <Heading className={cn(HEADING_CLASS, 'flex min-w-0 items-center')}>
        {onToggle ? (
          <button
            aria-expanded={!collapsed}
            className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground-secondary"
            onClick={onToggle}
            type="button"
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {label}
          </button>
        ) : (
          label
        )}
      </Heading>
      <div className="flex shrink-0 items-center gap-2">
        {meta}
        {action}
      </div>
    </div>
  );
}

interface SectionAddButtonProps {
  disabled?: boolean;
  /** Replace the leading plus, e.g. with a paperclip for "Attach". */
  icon?: ReactNode;
  label: string;
  onClick: () => void;
}

/**
 * The "+ Add X" ghost button that sits in a SectionHeader's action slot.
 * Previously copy-pasted verbatim across relations, sub-issues, milestones and
 * the update sections.
 */
export function SectionAddButton({ disabled, icon, label, onClick }: SectionAddButtonProps) {
  return (
    <button
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon ?? <Plus className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}
