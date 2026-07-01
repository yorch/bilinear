'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { usePopover } from '@/hooks/use-popover';
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
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search.trim() ? items.filter(item => matchesSearch(item, search)) : items;

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        onClick={() => (isOpen ? close() : setOpen(true))}
        title={triggerTitle}
        type="button"
      >
        {triggerChildren}
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input
            className="mb-1 w-full rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-xs outline-none placeholder:text-zinc-400 focus:border-indigo-500 dark:border-zinc-700"
            onChange={e => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            ref={inputRef}
            type="text"
            value={search}
          />

          {onClear && (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              onClick={() => {
                onClear();
                close();
              }}
              type="button"
            >
              {clearLabel}
            </button>
          )}

          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-zinc-400">{emptyText}</p>
            ) : (
              filtered.map(item => (
                <button
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    isSelected(item)
                      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                      : 'text-zinc-700 dark:text-zinc-300',
                  )}
                  key={getKey(item)}
                  onClick={() => {
                    onSelect(item);
                    close();
                  }}
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
