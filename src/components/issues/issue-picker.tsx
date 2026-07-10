'use client';

import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { useStore } from '@/providers/store-provider';

interface IssuePickerProps {
  disabled?: boolean;
  /** Issue id to exclude from results (typically the issue being linked itself). */
  excludeId?: string;
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
  disabled,
  excludeId,
  forceOpen,
  onClose,
  onSelect,
  triggerChildren,
  triggerClassName,
  triggerTitle,
}: IssuePickerProps) {
  const t = useTranslations();
  const { issueStore } = useStore();

  return (
    <SearchableSelectPopover<DBIssue>
      disabled={disabled}
      emptyText={t('issues.pickerNoIssuesFound')}
      forceOpen={forceOpen}
      getKey={issue => issue.id}
      listClassName="max-h-56"
      onClose={onClose}
      onSearch={query => issueStore.search(query, 20).filter(i => i.id !== excludeId)}
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
