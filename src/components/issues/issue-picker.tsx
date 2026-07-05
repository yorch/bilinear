'use client';

import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { cn } from '@/lib/utils';
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
  const {
    open: isOpen,
    setOpen,
    ref: containerRef,
  } = usePopover({
    closeOnEscape: true,
    forceOpen,
    onClose,
  });
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  useRestoreFocus(isOpen, triggerRef);

  const results = search.trim()
    ? issueStore.search(search, 20).filter(i => i.id !== excludeId)
    : [];
  const activeItem = activeIndex >= 0 ? results[activeIndex] : undefined;
  const activeOptionId = activeItem ? `${listboxId}-${activeItem.id}` : undefined;

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActiveIndex(-1);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (activeOptionId) {
      document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeOptionId]);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  const select = (issue: DBIssue) => {
    onSelect(issue);
    close();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const issue = activeIndex >= 0 ? results[activeIndex] : results[0];
      if (issue) {
        select(issue);
      }
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
        )}
        disabled={disabled}
        onClick={() => (isOpen ? close() : setOpen(true))}
        ref={triggerRef}
        title={triggerTitle}
        type="button"
      >
        {triggerChildren}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <input
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded="true"
            className="mb-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
            onChange={e => {
              setSearch(e.target.value);
              setActiveIndex(-1);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={t('issues.pickerSearchPlaceholder')}
            ref={inputRef}
            role="combobox"
            type="text"
            value={search}
          />

          <div className="max-h-56 overflow-y-auto" id={listboxId} role="listbox">
            {search.trim() && results.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t('issues.pickerNoIssuesFound')}
              </p>
            ) : (
              results.map((issue, i) => (
                <button
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                    i === activeIndex && 'bg-muted',
                  )}
                  id={`${listboxId}-${issue.id}`}
                  key={issue.id}
                  onClick={() => select(issue)}
                  role="option"
                  type="button"
                >
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {issue.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-foreground">
                    {issue.title}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});
