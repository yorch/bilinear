'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';
import type { SlashCommandItem } from './slash-commands';

interface SlashCommandListProps {
  command: (item: SlashCommandItem) => void;
  items: SlashCommandItem[];
}

export interface SlashCommandListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

// `SlashCommandItem.title`/`.description` are defined statically in
// `./slash-commands` (outside the i18n scope of this component). Map each
// item's stable `id` to an `editor.slashMenu.*` translation key here instead
// of translating at the source, and fall back to the static English text if
// an id isn't in the map.
const SLASH_ITEM_KEYS: Record<string, string> = {
  blockquote: 'blockquote',
  'bullet-list': 'bulletList',
  'code-block': 'codeBlock',
  diagram: 'diagram',
  divider: 'divider',
  embed: 'embed',
  heading1: 'heading1',
  heading2: 'heading2',
  heading3: 'heading3',
  'numbered-list': 'numberedList',
  table: 'table',
  'task-list': 'taskList',
  toggle: 'toggle',
};

export const SlashCommandList = forwardRef<SlashCommandListHandle, SlashCommandListProps>(
  function SlashCommandList({ items, command }, ref) {
    const t = useTranslations();
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);

    // biome-ignore lint/correctness/useExhaustiveDependencies: items triggers reset
    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
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
        <div className="slash-popup rounded-md border border-border bg-card p-2 text-xs text-muted-foreground shadow-lg">
          {t('editor.noResults')}
        </div>
      );
    }

    return (
      <ul
        className="slash-popup max-h-72 w-64 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg"
        ref={listRef}
      >
        {items.map((item, index) => {
          const key = SLASH_ITEM_KEYS[item.id];
          const title = key ? t(`editor.slashMenu.${key}.title`) : item.title;
          const description = key ? t(`editor.slashMenu.${key}.description`) : item.description;
          return (
            <li key={item.id}>
              <button
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors',
                  index === selectedIndex
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800',
                )}
                onMouseDown={e => {
                  e.preventDefault();
                  command(item);
                }}
                type="button"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-card font-mono text-xs text-muted-foreground">
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  },
);
