'use client';

import type { ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { usePopoverFlip } from '@/hooks/use-popover-flip';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { cn } from '@/lib/utils';

interface SearchableSelectPopoverProps<T> {
  /** Which edge of the trigger the panel hugs. Defaults to the left edge. */
  align?: 'left' | 'right';
  /** Class for the wrapper (the positioning context), e.g. layout tweaks from a parent row. */
  className?: string;
  clearLabel?: ReactNode;
  /**
   * Keep the panel open after a pick — for multi-select lists (labels), where
   * the reader toggles several rows. Defaults to true (single-select).
   */
  closeOnSelect?: boolean;
  disabled?: boolean;
  emptyText: string;
  /**
   * Rendered under the list with the live query, e.g. a "Create label “x”" row.
   * Receives `close` so the action can dismiss the panel.
   */
  footer?: (ctx: { close: () => void; search: string }) => ReactNode;
  forceOpen?: boolean;
  getKey: (item: T) => string;
  isSelected?: (item: T) => boolean;
  /** Static list, filtered locally via matchesSearch. Mutually exclusive with onSearch. */
  items?: T[];
  listClassName?: string;
  /** Local filter predicate, used against `items`. Required when `items` is passed. */
  matchesSearch?: (item: T, search: string) => boolean;
  /** Marks the listbox `aria-multiselectable` (pair with `closeOnSelect={false}`). */
  multiple?: boolean;
  onClear?: () => void;
  onClose?: () => void;
  /**
   * Live query function (e.g. a store's fuzzy search), called on every
   * keystroke instead of filtering a static `items` array. Mutually
   * exclusive with items/matchesSearch. The panel shows nothing until the
   * user types (no "no results" flash on open).
   */
  onSearch?: (query: string) => T[];
  onSelect: (item: T) => void;
  open?: boolean;
  panelClassName?: string;
  panelDataTestId?: string;
  renderItem: (item: T) => ReactNode;
  searchPlaceholder: string;
  triggerChildren: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}

export function SearchableSelectPopover<T>({
  align = 'left',
  className,
  closeOnSelect = true,
  footer,
  multiple,
  panelDataTestId,
  open: controlledOpen,
  disabled,
  forceOpen,
  onClose,
  items,
  matchesSearch,
  onSearch,
  getKey,
  isSelected,
  onSelect,
  renderItem,
  onClear,
  clearLabel,
  emptyText,
  searchPlaceholder,
  triggerChildren,
  triggerClassName,
  triggerTitle,
  panelClassName,
  listClassName,
}: SearchableSelectPopoverProps<T>) {
  const {
    open: isOpen,
    setOpen,
    ref: containerRef,
  } = usePopover({
    closeOnEscape: true,
    forceOpen,
    onClose,
    open: controlledOpen,
  });
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  useRestoreFocus(isOpen, triggerRef);
  const openUpward = usePopoverFlip(isOpen, triggerRef);

  const filtered = onSearch
    ? search.trim()
      ? onSearch(search)
      : []
    : search.trim()
      ? (items ?? []).filter(item => matchesSearch?.(item, search))
      : (items ?? []);
  // In live-search mode, an empty box before typing isn't "no results" —
  // only show the empty state once a search has actually run dry.
  const showEmpty = filtered.length === 0 && (!onSearch || search.trim() !== '');
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
        if (closeOnSelect) {
          close();
        }
      }
    }
  };

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
        )}
        disabled={disabled}
        // Stops the click reaching a clickable row (issue rows open the detail
        // panel on click); SelectPopover's trigger does the same.
        onClick={e => {
          e.stopPropagation();
          if (isOpen) {
            close();
          } else {
            setOpen(true);
          }
        }}
        onKeyDown={e => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isOpen) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        ref={triggerRef}
        title={triggerTitle}
        type="button"
      >
        {triggerChildren}
      </button>

      {isOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only stop events reaching a clickable parent row (and its hotkeys); the controls inside are the interactive elements
        <div
          className={cn(
            'absolute z-50 w-56 rounded-lg border border-border bg-popover p-1 shadow-e2',
            align === 'right' ? 'right-0' : 'left-0',
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
            panelClassName,
          )}
          data-testid={panelDataTestId}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => {
            // Typed characters stay inside the panel; modified chords (⌘K) must
            // still reach window listeners such as the palette hotkey.
            if (!(e.metaKey || e.ctrlKey)) {
              e.stopPropagation();
            }
          }}
        >
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

          <div
            aria-multiselectable={multiple || undefined}
            className={cn('max-h-48 overflow-y-auto', listClassName)}
            id={listboxId}
            role="listbox"
          >
            {showEmpty ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
            ) : (
              filtered.map((item, i) => (
                <button
                  aria-selected={isSelected?.(item) ?? false}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                    isSelected?.(item)
                      ? 'bg-brand-subtle text-brand-subtle-foreground'
                      : 'text-foreground',
                    i === activeIndex && 'bg-muted',
                  )}
                  id={`${listboxId}-${getKey(item)}`}
                  key={getKey(item)}
                  onClick={() => {
                    onSelect(item);
                    if (closeOnSelect) {
                      close();
                    }
                  }}
                  role="option"
                  type="button"
                >
                  {renderItem(item)}
                </button>
              ))
            )}
          </div>
          {footer?.({ close, search })}
        </div>
      )}
    </div>
  );
}
