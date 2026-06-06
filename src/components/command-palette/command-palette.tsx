'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RecentItem } from '@/hooks/use-recent-items';
import type { DBIssue } from '@/lib/db';
import { IDENTIFIER_RE } from '@/lib/identifiers';
import { getPriorityConfig } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IssueItem = {
  issue: DBIssue;
  kind: 'issue';
  stateColor?: string;
  teamKey: string;
};
type ActionItem = {
  id: string;
  keywords: string[];
  kind: 'action';
  label: string;
  onSelect: () => void;
  shortcut?: string;
};
type ResultItem = IssueItem | ActionItem;

type SubMenuMode =
  | { type: 'none' }
  | { issueId: string; type: 'setStatus' }
  | { issueId: string; type: 'setAssignee' }
  | { issueId: string; type: 'setPriority' }
  | { issueId: string; type: 'setLabel' };

type SubMenuItem = { label: string; onSelect: () => void };

const SUBMENU_PLACEHOLDERS = {
  setAssignee: 'Set assignee…',
  setLabel: 'Set label…',
  setPriority: 'Set priority…',
  setStatus: 'Set status…',
} satisfies Record<Exclude<SubMenuMode['type'], 'none'>, string>;

// ---------------------------------------------------------------------------
// ResultsList — observer: issueStore + workflowStateStore + teamStore
// ---------------------------------------------------------------------------

interface ResultsListProps {
  activeIndex: number;
  onItemsChange: (items: ResultItem[]) => void;
  query: string;
  recentItems: RecentItem[];
  router: ReturnType<typeof useRouter>;
  selectItem: (item: ResultItem | undefined) => void;
  workspaceKey: string;
}

const ResultsList = observer(function ResultsList({
  activeIndex,
  onItemsChange,
  query,
  recentItems,
  router,
  selectItem,
  workspaceKey,
}: ResultsListProps) {
  const { issueStore, teamStore, uiStore, workflowStateStore } = useStore();

  const trimmed = (query || '').trim().toUpperCase();
  const exactIdentifier = IDENTIFIER_RE.test(trimmed)
    ? (issueStore.findByIdentifier(trimmed) ?? undefined)
    : undefined;
  const matched = issueStore.search(query || '', 10);
  const recent = query
    ? []
    : recentItems
        .map(r => issueStore.findById(r.id))
        .filter((i): i is DBIssue => i !== null)
        .slice(0, 5);
  let issues = query ? matched : recent;
  if (exactIdentifier) {
    issues = [exactIdentifier, ...issues.filter(i => i.id !== exactIdentifier.id)];
  }
  const issueItems: IssueItem[] = issues.map(issue => ({
    issue,
    kind: 'issue' as const,
    stateColor: workflowStateStore.findById(issue.stateId)?.color,
    teamKey: teamStore.findById(issue.teamId)?.key ?? '',
  }));

  const baseActions: ActionItem[] = [
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
  const actionItems: ActionItem[] = query
    ? baseActions.filter(a => {
        const q = query.toLowerCase();
        return a.label.toLowerCase().includes(q) || a.keywords.some(k => k.includes(q));
      })
    : baseActions;

  const allItems: ResultItem[] = [...issueItems, ...actionItems];

  // Ref mutation — safe during render, keeps parent's keyStateRef current
  onItemsChange(allItems);

  return (
    <>
      {allItems.length === 0 && (
        <p className="px-4 py-3 text-sm text-zinc-400">No results for &ldquo;{query}&rdquo;</p>
      )}

      {issueItems.length > 0 && (
        <>
          <p className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
            {query ? 'Issues' : 'Recent'}
          </p>
          {issueItems.map((item, i) => (
            <button
              aria-selected={i === activeIndex}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2 text-sm',
                i === activeIndex
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
              )}
              data-highlighted={i === activeIndex ? 'true' : undefined}
              data-idx={i}
              data-testid="command-palette-item"
              key={item.issue.id}
              onClick={() => selectItem(item)}
              role="option"
              type="button"
            >
              {item.stateColor && (
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: item.stateColor }}
                />
              )}
              <span className="w-16 flex-shrink-0 font-mono text-xs text-zinc-400">
                {item.issue.identifier}
              </span>
              <span className="flex-1 truncate text-zinc-900 dark:text-zinc-100">
                {item.issue.title}
              </span>
              {item.teamKey && (
                <span className="flex-shrink-0 text-xs text-zinc-400">{item.teamKey}</span>
              )}
            </button>
          ))}
        </>
      )}

      {actionItems.length > 0 && (
        <>
          <p className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Actions
          </p>
          {actionItems.map((item, i) => {
            const globalIdx = issueItems.length + i;
            return (
              <button
                aria-selected={globalIdx === activeIndex}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-sm',
                  globalIdx === activeIndex
                    ? 'bg-zinc-100 dark:bg-zinc-800'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                )}
                data-highlighted={globalIdx === activeIndex ? 'true' : undefined}
                data-idx={globalIdx}
                data-testid="command-palette-item"
                key={item.id}
                onClick={() => selectItem(item)}
                role="option"
                type="button"
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
  );
});

// ---------------------------------------------------------------------------
// SubMenuList — observer: issueStore + workflowStateStore + userStore + labelStore
// ---------------------------------------------------------------------------

interface SubMenuListProps {
  activeIndex: number;
  onClose: () => void;
  onItemsChange: (items: SubMenuItem[]) => void;
  subMenu: SubMenuMode;
}

const SubMenuList = observer(function SubMenuList({
  activeIndex,
  onClose,
  onItemsChange,
  subMenu,
}: SubMenuListProps) {
  const { issueStore, labelStore, userStore, workflowStateStore } = useStore();

  let subItems: SubMenuItem[] = [];

  if (subMenu.type === 'setStatus') {
    const issue = issueStore.findById(subMenu.issueId);
    if (issue) {
      const states = workflowStateStore.findByTeamId(issue.teamId);
      subItems = states.map(s => ({
        label: s.name,
        onSelect: () => {
          issueStore.optimisticUpdate(subMenu.issueId, { stateId: s.id });
          onClose();
        },
      }));
    }
  } else if (subMenu.type === 'setAssignee') {
    const users = userStore.all;
    subItems = [
      {
        label: 'No assignee',
        onSelect: () => {
          issueStore.optimisticUpdate(subMenu.issueId, { assigneeId: null });
          onClose();
        },
      },
      ...users.map(u => ({
        label: u.displayName,
        onSelect: () => {
          issueStore.optimisticUpdate(subMenu.issueId, { assigneeId: u.id });
          onClose();
        },
      })),
    ];
  } else if (subMenu.type === 'setPriority') {
    subItems = ([0, 1, 2, 3, 4] as const).map(p => ({
      label: getPriorityConfig(p).label,
      onSelect: () => {
        issueStore.optimisticUpdate(subMenu.issueId, { priority: p });
        onClose();
      },
    }));
  } else if (subMenu.type === 'setLabel') {
    const issue = issueStore.findById(subMenu.issueId);
    if (issue) {
      subItems = labelStore.all.map(l => ({
        label: l.name,
        onSelect: () => {
          const current = issue.labelIds ?? [];
          const next = current.includes(l.id)
            ? current.filter(id => id !== l.id)
            : [...current, l.id];
          issueStore.optimisticUpdate(subMenu.issueId, { labelIds: next });
          onClose();
        },
      }));
    }
  }

  // Ref mutation — safe during render
  onItemsChange(subItems);

  return (
    <>
      {subItems.length === 0 && <p className="px-4 py-3 text-sm text-zinc-400">No options</p>}
      {subItems.map((item, i) => (
        <button
          aria-selected={i === activeIndex}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 text-sm',
            i === activeIndex
              ? 'bg-zinc-100 dark:bg-zinc-800'
              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
          )}
          data-idx={i}
          key={item.label}
          onClick={item.onSelect}
          role="option"
          type="button"
        >
          <span className="text-zinc-900 dark:text-zinc-100">{item.label}</span>
        </button>
      ))}
    </>
  );
});

// ---------------------------------------------------------------------------
// CommandPaletteFooter — static, memo'd to avoid re-renders on query change
// ---------------------------------------------------------------------------

const CommandPaletteFooter = memo(function CommandPaletteFooter({
  inSubMenu,
}: {
  inSubMenu: boolean;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
      <span className="text-[10px] text-zinc-400">
        <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">↑↓</kbd> Navigate
      </span>
      <span className="text-[10px] text-zinc-400">
        <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">↵</kbd> Select
      </span>
      <span className="text-[10px] text-zinc-400">
        <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">Esc</kbd>{' '}
        {inSubMenu ? 'Back' : 'Close'}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// CommandPaletteContent — non-observer, owns all state + keyboard nav
// ---------------------------------------------------------------------------

function CommandPaletteContent({ recentItems }: { recentItems: RecentItem[] }) {
  const { uiStore } = useStore();
  const router = useRouter();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [subMenu, setSubMenu] = useState<SubMenuMode>({ type: 'none' });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Refs holding latest item arrays for the keyboard handler — updated by
  // child observers during their renders, not from this component
  const allItemsRef = useRef<ResultItem[]>([]);
  const subItemsRef = useRef<SubMenuItem[]>([]);

  useEffect(() => {
    setQuery('');
    setActiveIndex(-1);
    setSubMenu({ type: 'none' });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const clampIndex = useCallback(
    (items: unknown[], idx: number) => Math.max(0, Math.min(idx, items.length - 1)),
    [],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const selectItem = useCallback(
    (item: ResultItem | undefined) => {
      if (!item) {
        return;
      }
      if (item.kind === 'issue') {
        router.push(`/${workspaceKey}/issue/${item.issue.id}`);
        uiStore.closeCommandPalette();
      } else {
        item.onSelect();
      }
    },
    [router, workspaceKey, uiStore],
  );

  // Keep a ref with the latest handler state so the event listener registered
  // once below can always read fresh values without being re-registered.
  const keyStateRef = useRef({
    activeIndex,
    allItemsRef,
    clampIndex,
    inSubMenu: false,
    selectItem,
    setActiveIndex,
    setSubMenu,
    subItemsRef,
    uiStore,
  });
  keyStateRef.current = {
    activeIndex,
    allItemsRef,
    clampIndex,
    inSubMenu: subMenu.type !== 'none',
    selectItem,
    setActiveIndex,
    setSubMenu,
    subItemsRef,
    uiStore,
  };

  // Registered once; reads fresh state via keyStateRef on every invocation
  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const {
        activeIndex: idx,
        allItemsRef: allRef,
        clampIndex: clamp,
        inSubMenu: inSub,
        selectItem: select,
        setActiveIndex: setIdx,
        setSubMenu: setSub,
        subItemsRef: subRef,
        uiStore: ui,
      } = keyStateRef.current;
      const items = inSub ? subRef.current : allRef.current;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx(i => clamp(items, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx(i => clamp(items, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (inSub) {
          subRef.current[idx]?.onSelect();
        } else {
          const target = idx === -1 ? allRef.current[0] : allRef.current[idx];
          select(target);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (inSub) {
          setSub({ type: 'none' });
          setIdx(0);
        } else {
          ui.closeCommandPalette();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const inSubMenu = subMenu.type !== 'none';

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-50 bg-black/30"
        onClick={() => uiStore.closeCommandPalette()}
      />

      {/* Dialog */}
      <div
        aria-label="Command palette"
        aria-modal="true"
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        data-testid="command-palette"
        role="dialog"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {inSubMenu && (
            <button
              aria-label="Back"
              className="flex-shrink-0 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={() => {
                setSubMenu({ type: 'none' });
                setActiveIndex(0);
              }}
              type="button"
            >
              ← Back
            </button>
          )}
          <svg
            aria-hidden="true"
            className="h-4 w-4 flex-shrink-0 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
          <input
            aria-label={
              inSubMenu
                ? (SUBMENU_PLACEHOLDERS[subMenu.type as keyof typeof SUBMENU_PLACEHOLDERS] ??
                  'Search')
                : 'Search issues and commands'
            }
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
            onChange={e => setQuery(e.target.value)}
            placeholder={
              inSubMenu
                ? (SUBMENU_PLACEHOLDERS[subMenu.type as keyof typeof SUBMENU_PLACEHOLDERS] ??
                  'Search…')
                : 'Search issues, commands…'
            }
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={query}
          />
        </div>

        {/* Results */}
        <div
          className="max-h-80 overflow-y-auto py-1"
          data-testid="command-palette-results"
          ref={listRef}
          role="listbox"
        >
          {inSubMenu ? (
            <SubMenuList
              activeIndex={activeIndex}
              onClose={() => uiStore.closeCommandPalette()}
              onItemsChange={items => {
                subItemsRef.current = items;
              }}
              subMenu={subMenu}
            />
          ) : (
            <ResultsList
              activeIndex={activeIndex}
              onItemsChange={items => {
                allItemsRef.current = items;
              }}
              query={query}
              recentItems={recentItems}
              router={router}
              selectItem={selectItem}
              workspaceKey={workspaceKey}
            />
          )}
        </div>

        <CommandPaletteFooter inSubMenu={inSubMenu} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// CommandPalette — public export, observer: uiStore.commandPaletteOpen only
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  recentItems?: RecentItem[];
}

export const CommandPalette = observer(function CommandPalette({
  recentItems = [],
}: CommandPaletteProps) {
  const { uiStore } = useStore();
  if (!uiStore.commandPaletteOpen) {
    return null;
  }
  return <CommandPaletteContent recentItems={recentItems} />;
});
