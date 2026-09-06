import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

interface SectionHeaderProps {
  /** Optional right-aligned control, e.g. a <SectionAddButton />. */
  action?: ReactNode;
  /** Heading level to render, for document-outline correctness. Defaults to h3. */
  as?: 'h2' | 'h3' | 'h4';
  /** Heading content — a plain string or a node (e.g. title plus an inline count). */
  title: ReactNode;
}

/**
 * The uppercase, muted subsection header shared across issue-detail and
 * project/initiative sections: a `flex items-center justify-between` row with
 * a styled heading on the left and an optional action on the right.
 */
export function SectionHeader({ title, action, as = 'h3' }: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className="flex items-center justify-between">
      <Heading className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </Heading>
      {action}
    </div>
  );
}

interface SectionAddButtonProps {
  label: string;
  onClick: () => void;
}

/**
 * The "+ Add X" ghost button that sits in a SectionHeader's action slot.
 * Previously copy-pasted verbatim across relations, sub-issues, milestones and
 * the update sections. Usable on its own where the surrounding row is not a
 * SectionHeader (sub-issues nests it beside a progress bar).
 */
export function SectionAddButton({ label, onClick }: SectionAddButtonProps) {
  return (
    <button
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
      onClick={onClick}
      type="button"
    >
      <Plus className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
