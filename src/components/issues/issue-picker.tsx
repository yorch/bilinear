'use client';

import { observer } from 'mobx-react-lite';
import { type ReactNode, useMemo } from 'react';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { useStore } from '@/providers/store-provider';

interface IssuePickerProps {
  /** Which edge of the trigger the panel is anchored to; use `right` in right-hand rails. */
  align?: 'left' | 'right';
  disabled?: boolean;
  /** Issue id to exclude from results (typically the issue being linked itself). */
  excludeId?: string;
  /** Further ids to hide (e.g. an issue's descendants when choosing its parent). */
  excludeIds?: ReadonlySet<string>;
  /** Forces the popover open once (e.g. a keyboard shortcut) — see StatusSelect. */
  forceOpen?: boolean;
  onClose?: () => void;
  onSelect: (issue: DBIssue) => void;
  triggerChildren: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}

/**
 * Searchable issue lookup, backed by issueStore.search's fuzzy identifier +
 * title ranking. Used wherever the app previously asked for an exact
 * identifier via window.prompt or a plain text field (mark-as-duplicate,
 * add-relation) — replaces "type ENG-42 and hope it's right" with a real
 * search-and-pick list.
 */
export const IssuePicker = observer(function IssuePicker({
  align,
  disabled,
  excludeId,
  excludeIds,
  forceOpen,
  onClose,
  onSelect,
  triggerChildren,
  triggerClassName,
  triggerTitle,
}: IssuePickerProps) {
  const t = useTranslations();
  const { issueStore } = useStore();
  const poolSize = issueStore.pool.size;
  // Before anything is typed, offer the most recently touched issues rather
  // than a bare input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: poolSize stands in for the observable pool
  const recent = useMemo(
    () =>
      Array.from(issueStore.pool.values())
        .filter(i => !i.trashed && !i.archivedAt && i.id !== excludeId && !excludeIds?.has(i.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 5),
    [issueStore, poolSize, excludeId, excludeIds],
  );

  return (
    <SearchableSelectPopover<DBIssue>
      align={align}
      disabled={disabled}
      emptyText={t('issues.pickerNoIssuesFound')}
      forceOpen={forceOpen}
      getKey={issue => issue.id}
      idleItems={recent}
      listClassName="max-h-56"
      onClose={onClose}
      onSearch={query =>
        issueStore
          .search(query, excludeIds ? 50 : 20)
          .filter(i => i.id !== excludeId && !excludeIds?.has(i.id))
          .slice(0, 20)
      }
      onSelect={onSelect}
      panelClassName="w-72"
      renderItem={issue => (
        <>
          <span className="shrink-0 font-mono text-muted-foreground">{issue.identifier}</span>
          <span className="min-w-0 flex-1 truncate text-left text-foreground">{issue.title}</span>
        </>
      )}
      searchPlaceholder={t('issues.pickerSearchPlaceholder')}
      triggerChildren={triggerChildren}
      triggerClassName={triggerClassName}
      triggerTitle={triggerTitle}
    />
  );
});
