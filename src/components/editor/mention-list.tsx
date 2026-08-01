'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

export interface MentionItem {
  id: string;
  label: string;
  /** Optional secondary text (e.g. issue identifier) */
  sub?: string;
}

interface MentionListProps {
  command: (item: MentionItem) => void;
  items: MentionItem[];
}

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

/**
 * Floating dropdown rendered inside a TipTap suggestion popup.
 * The parent calls `onKeyDown` via an imperative ref so keyboard
 * navigation works without fighting focus.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { items, command },
  ref,
) {
  const t = useTranslations();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset selection when the items array changes (items is the trigger, not read inside)
  // biome-ignore lint/correctness/useExhaustiveDependencies: items triggers reset
  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  // Scroll selected item into view
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
      <div className="mention-popup rounded-md border border-border bg-card p-2 text-xs text-muted-foreground shadow-e2">
        {t('editor.noResults')}
      </div>
    );
  }

  return (
    <ul
      className="mention-popup max-h-48 w-48 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-e2"
      ref={listRef}
    >
      {items.map((item, index) => (
        <li key={item.id}>
          <button
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
              index === selectedIndex
                ? 'bg-brand-subtle text-brand-subtle-foreground'
                : 'text-foreground-secondary hover:bg-accent',
            )}
            onMouseDown={e => {
              e.preventDefault();
              command(item);
            }}
            type="button"
          >
            <span className="flex-1 truncate">{item.label}</span>
            {item.sub && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.sub}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
});
