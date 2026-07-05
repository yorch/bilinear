'use client';

import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { cn } from '@/lib/utils';

interface SearchableSelectPopoverProps<T> {
  clearLabel?: ReactNode;
  emptyText: string;
  getKey: (item: T) => string;
  isSelected: (item: T) => boolean;
  items: T[];
  matchesSearch: (item: T, search: string) => boolean;
  onClear?: () => void;
  onClose?: () => void;
  onSelect: (item: T) => void;
  open?: boolean;
  renderItem: (item: T) => ReactNode;
  searchPlaceholder: string;
  triggerChildren: ReactNode;
  triggerTitle?: string;
}

export function SearchableSelectPopover<T>({
  open: controlledOpen,
  onClose,
  items,
  matchesSearch,
  getKey,
  isSelected,
  onSelect,
  renderItem,
  onClear,
  clearLabel,
  emptyText,
  searchPlaceholder,
  triggerChildren,
  triggerTitle,
}: SearchableSelectPopoverProps<T>) {
  const {
    open: isOpen,
    setOpen,
    ref: containerRef,
  } = usePopover({
    closeOnEscape: true,
    onClose,
    open: controlledOpen,
  });
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  useRestoreFocus(isOpen, triggerRef);

  const filtered = search.trim() ? items.filter(item => matchesSearch(item, search)) : items;
  const activeItem = activeIndex >= 0 ? filtered[activeIndex] : undefined;
  const activeOptionId = activeItem ? `${listboxId}-${getKey(activeItem)}` : undefined;

  // Reset and focus the search input on open (useRestoreFocus returns focus
  // to the trigger on close).
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setActiveIndex(-1);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (activeOptionId) {
      document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeOptionId]);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = activeIndex >= 0 ? filtered[activeIndex] : filtered[0];
      if (item) {
        onSelect(item);
        close();
      }
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => (isOpen ? close() : setOpen(true))}
        ref={triggerRef}
        title={triggerTitle}
        type="button"
      >
        {triggerChildren}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
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
            placeholder={searchPlaceholder}
            ref={inputRef}
            role="combobox"
            type="text"
            value={search}
          />

          {onClear && (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
              onClick={() => {
                onClear();
                close();
              }}
              type="button"
            >
              {clearLabel}
            </button>
          )}

          <div className="max-h-48 overflow-y-auto" id={listboxId} role="listbox">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
            ) : (
              filtered.map((item, i) => (
                <button
                  aria-selected={isSelected(item)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                    isSelected(item)
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'text-foreground',
                    i === activeIndex && 'bg-muted',
                  )}
                  id={`${listboxId}-${getKey(item)}`}
                  key={getKey(item)}
                  onClick={() => {
                    onSelect(item);
                    close();
                  }}
                  role="option"
                  type="button"
                >
                  {renderItem(item)}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
