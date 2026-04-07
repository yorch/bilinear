'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecentItem } from '@/hooks/use-recent-items';
import { useStore } from '@/providers/store-provider';
import type { DBIssue } from '@/lib/db';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResultItem =
  | { kind: 'issue'; issue: DBIssue; teamKey: string }
  | { kind: 'action'; id: string; label: string; keywords: string[]; shortcut?: string; onSelect: () => void };

type SubMenuMode =
  | { type: 'none' }
  | { type: 'setStatus'; issueId: string }
  | { type: 'setAssignee'; issueId: string }
  | { type: 'setPriority'; issueId: string }
  | { type: 'setLabel'; issueId: string };

// ---------------------------------------------------------------------------
// Priority labels
// ---------------------------------------------------------------------------

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

// ---------------------------------------------------------------------------
// CommandPalette
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  recentItems?: RecentItem[];
}

export const CommandPalette = observer(function CommandPalette({
  recentItems = [],
}: CommandPaletteProps) {
  const { uiStore, issueStore, workflowStateStore, userStore, labelStore, teamStore } =
    useStore();
  const router = useRouter();
  // Read workspace key from URL — works in any nested route under [workspace]
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [subMenu, setSubMenu] = useState<SubMenuMode>({ type: 'none' });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when palette opens
  useEffect(() => {
    if (uiStore.commandPaletteOpen) {
      setQuery('');
      setActiveIndex(0);
      setSubMenu({ type: 'none' });
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [uiStore.commandPaletteOpen]);

  // Ensure active index stays in bounds
  const clampIndex = useCallback(
    (items: ResultItem[], idx: number) =>
      Math.max(0, Math.min(idx, items.length - 1)),
    [],
  );

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-idx="${activeIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // ── Build result items ───────────────────────────────────────────────────

  const buildIssueItems = useCallback((): ResultItem[] => {
    const matched = issueStore.search(query || '', 10);
    const recent = query
      ? []
      : recentItems
          .map(r => issueStore.findById(r.id))
          .filter((i): i is DBIssue => i !== null)
          .slice(0, 5);

    const issues = query ? matched : recent;

    return issues.map(issue => {
      const team = teamStore.findById(issue.teamId);
      return {
        issue,
        kind: 'issue' as const,
        teamKey: team?.key ?? '',
      };
    });
  }, [query, issueStore, recentItems, teamStore]);

  const buildActionItems = useCallback((): ResultItem[] => {
    const actions: ResultItem[] = [
      {
        id: 'create-issue',
        keywords: ['create issue', 'new issue', 'add issue'],
        kind: 'action',
        label: 'Create new issue',
        onSelect: () => {
          uiStore.closeCommandPalette();
          uiStore.openCreateIssueModal();
        },
        shortcut: 'C',
      },
      {
        id: 'go-settings',
        keywords: ['settings', 'preferences', 'config'],
        kind: 'action',
        label: 'Go to Settings',
        onSelect: () => {
          uiStore.closeCommandPalette();
          router.push(`/${workspaceKey}/settings`);
        },
      },
    ];

    if (!query) return actions;

    const q = query.toLowerCase();
    return actions.filter(
      a =>
        a.label.toLowerCase().includes(q) ||
        a.keywords.some(k => k.includes(q)),
    );
  }, [query, uiStore, router, workspaceKey]);

  const issueItems = buildIssueItems();
  const actionItems = buildActionItems();
  const allItems: ResultItem[] = [...issueItems, ...actionItems];

  // ── Sub-menu items ────────────────────────────────────────────────────────

  const buildSubMenuItems = (): Array<{ label: string; onSelect: () => void }> => {
    if (subMenu.type === 'setStatus') {
      const issue = issueStore.findById(subMenu.issueId);
      if (!issue) return [];
      const states = workflowStateStore.findByTeamId(issue.teamId);
      return states.map(s => ({
        label: s.name,
        onSelect: () => {
          // The team page's onUpdate handles the actual mutation;
          // here we just update the store optimistically and close.
          issueStore.optimisticUpdate(subMenu.issueId, { stateId: s.id });
          uiStore.closeCommandPalette();
        },
      }));
    }
    if (subMenu.type === 'setAssignee') {
      const users = userStore.all;
      const none = {
        label: 'No assignee',
        onSelect: () => {
          issueStore.optimisticUpdate(subMenu.issueId, { assigneeId: null });
          uiStore.closeCommandPalette();
        },
      };
      return [
        none,
        ...users.map(u => ({
          label: u.displayName,
          onSelect: () => {
            issueStore.optimisticUpdate(subMenu.issueId, { assigneeId: u.id });
            uiStore.closeCommandPalette();
          },
        })),
      ];
    }
    if (subMenu.type === 'setPriority') {
      return ([0, 1, 2, 3, 4] as const).map(p => ({
        label: PRIORITY_LABELS[p],
        onSelect: () => {
          issueStore.optimisticUpdate(subMenu.issueId, { priority: p });
          uiStore.closeCommandPalette();
        },
      }));
    }
    if (subMenu.type === 'setLabel') {
      const issue = issueStore.findById(subMenu.issueId);
      if (!issue) return [];
      const allLabels = labelStore.all;
      return allLabels.map(l => ({
        label: l.name,
        onSelect: () => {
          const current = issue.labelIds ?? [];
          const next = current.includes(l.id)
            ? current.filter(id => id !== l.id)
            : [...current, l.id];
          issueStore.optimisticUpdate(subMenu.issueId, { labelIds: next });
          uiStore.closeCommandPalette();
        },
      }));
    }
    return [];
  };

  const subItems = buildSubMenuItems();
  const inSubMenu = subMenu.type !== 'none';

  // ── Keyboard navigation ──────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = inSubMenu ? subItems : allItems;
    const count = items.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => clampIndex(items, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => clampIndex(items, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (inSubMenu) {
        subItems[activeIndex]?.onSelect();
      } else {
        selectItem(allItems[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inSubMenu) {
        setSubMenu({ type: 'none' });
        setActiveIndex(0);
      } else {
        uiStore.closeCommandPalette();
      }
    }
  };

  const selectItem = (item: ResultItem | undefined) => {
    if (!item) return;
    if (item.kind === 'issue') {
      router.push(`/${workspaceKey}/issue/${item.issue.id}`);
      uiStore.closeCommandPalette();
    } else {
      item.onSelect();
    }
  };

  // Reset activeIndex when items change
  useEffect(() => {
    setActiveIndex(0);
  }, [query, subMenu.type]);

  if (!uiStore.commandPaletteOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/30"
        onClick={() => uiStore.closeCommandPalette()}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {inSubMenu && (
            <button
              type="button"
              onClick={() => { setSubMenu({ type: 'none' }); setActiveIndex(0); }}
              className="flex-shrink-0 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label="Back"
            >
              ← Back
            </button>
          )}
          <svg
            className="h-4 w-4 flex-shrink-0 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={
              inSubMenu
                ? `${subMenu.type.replace('set', 'Set ')}…`
                : 'Search issues, commands…'
            }
            className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-80 overflow-y-auto py-1"
          role="listbox"
        >
          {inSubMenu ? (
            <>
              {subItems.length === 0 && (
                <p className="px-4 py-3 text-sm text-zinc-400">No options</p>
              )}
              {subItems.map((item, i) => (
                <button
                  key={item.label}
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  data-idx={i}
                  onClick={item.onSelect}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2 text-sm',
                    i === activeIndex
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                  )}
                >
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {item.label}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              {allItems.length === 0 && (
                <p className="px-4 py-3 text-sm text-zinc-400">
                  No results for &ldquo;{query}&rdquo;
                </p>
              )}

              {/* Issue results */}
              {issueItems.length > 0 && (
                <>
                  <p className="px-4 py-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    {query ? 'Issues' : 'Recent'}
                  </p>
                  {issueItems.map((item, i) => {
                    if (item.kind !== 'issue') return null;
                    const globalIdx = i;
                    const team = teamStore.findById(item.issue.teamId);
                    const state = workflowStateStore.findById(item.issue.stateId);
                    return (
                      <button
                        key={item.issue.id}
                        type="button"
                        role="option"
                        aria-selected={globalIdx === activeIndex}
                        data-idx={globalIdx}
                        onClick={() => selectItem(item)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2 text-sm',
                          globalIdx === activeIndex
                            ? 'bg-zinc-100 dark:bg-zinc-800'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                        )}
                      >
                        {state && (
                          <span
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: state.color }}
                          />
                        )}
                        <span className="w-16 flex-shrink-0 font-mono text-xs text-zinc-400">
                          {item.issue.identifier}
                        </span>
                        <span className="flex-1 truncate text-zinc-900 dark:text-zinc-100">
                          {item.issue.title}
                        </span>
                        {team && (
                          <span className="flex-shrink-0 text-xs text-zinc-400">
                            {team.key}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Action results */}
              {actionItems.length > 0 && (
                <>
                  <p className="px-4 py-1.5 text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Actions
                  </p>
                  {actionItems.map((item, i) => {
                    if (item.kind !== 'action') return null;
                    const globalIdx = issueItems.length + i;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={globalIdx === activeIndex}
                        data-idx={globalIdx}
                        onClick={() => selectItem(item)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2 text-sm',
                          globalIdx === activeIndex
                            ? 'bg-zinc-100 dark:bg-zinc-800'
                            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                        )}
                      >
                        <span className="flex-1 truncate text-zinc-900 dark:text-zinc-100">
                          {item.label}
                        </span>
                        {item.shortcut && (
                          <kbd className="flex-shrink-0 rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 dark:border-zinc-600">
                            {item.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <span className="text-[10px] text-zinc-400">
            <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">↑↓</kbd>{' '}
            Navigate
          </span>
          <span className="text-[10px] text-zinc-400">
            <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">↵</kbd>{' '}
            Select
          </span>
          <span className="text-[10px] text-zinc-400">
            <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">Esc</kbd>{' '}
            {inSubMenu ? 'Back' : 'Close'}
          </span>
        </div>
      </div>
    </>
  );
});
