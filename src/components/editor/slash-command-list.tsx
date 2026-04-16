'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { SlashCommandItem } from './slash-commands';

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashCommandList = forwardRef<
  SlashCommandListHandle,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items triggers reset
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

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
          if (item) command(item);
          return true;
        }
        return false;
      },
    }),
    [items, command, selectedIndex],
  );

  if (items.length === 0) {
    return (
      <div className="slash-popup rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-400 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        No results
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      className="slash-popup max-h-72 w-64 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {items.map((item, index) => (
        <li key={item.title}>
          <button
            type="button"
            onMouseDown={e => {
              e.preventDefault();
              command(item);
            }}
            className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors ${
              index === selectedIndex
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800'
            }`}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 font-mono text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {item.title}
              </span>
              <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">
                {item.description}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
});
