'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

export interface MentionItem {
  id: string;
  label: string;
  /** Optional secondary text (e.g. issue identifier) */
  sub?: string;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Floating dropdown rendered inside a TipTap suggestion popup.
 * The parent calls `onKeyDown` via an imperative ref so keyboard
 * navigation works without fighting focus.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    // Reset selection when the items array changes (items is the trigger, not read inside)
    // biome-ignore lint/correctness/useExhaustiveDependencies: items triggers reset
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    // Scroll selected item into view
    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as
        | HTMLElement
        | undefined;
      el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'ArrowUp') {
            setSelectedIndex(i => (i <= 0 ? items.length - 1 : i - 1));
            return true;
          }
          if (event.key === 'ArrowDown') {
            setSelectedIndex(i => (i >= items.length - 1 ? 0 : i + 1));
            return true;
          }
          if (event.key === 'Enter') {
            const item = items[selectedIndex];
            if (item) {
              command(item);
            }
            return true;
          }
          return false;
        },
      }),
      [items, command, selectedIndex],
    );

    if (items.length === 0) {
      return (
        <div className="mention-popup rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-400 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          No results
        </div>
      );
    }

    return (
      <ul
        ref={listRef}
        className="mention-popup max-h-48 w-48 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                command(item);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                index === selectedIndex
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                  : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="flex-1 truncate">{item.label}</span>
              {item.sub && (
                <span className="shrink-0 font-mono text-xs text-zinc-400">
                  {item.sub}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    );
  },
);
