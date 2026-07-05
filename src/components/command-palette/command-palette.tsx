'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import type { RecentItem } from '@/hooks/use-recent-items';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { IDENTIFIER_RE } from '@/lib/identifiers';
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
  | { issueId: string; type: 'actions' }
  | { issueId: string; type: 'setStatus' }
  | { issueId: string; type: 'setAssignee' }
  | { issueId: string; type: 'setPriority' }
  | { issueId: string; type: 'setLabel' };

type SubMenuItem = { id: string; label: string; onSelect: () => void };

const SUBMENU_PLACEHOLDER_KEYS = {
  actions: 'commandPalette.submenu.actions',
  setAssignee: 'commandPalette.submenu.setAssignee',
  setLabel: 'commandPalette.submenu.setLabel',
  setPriority: 'commandPalette.submenu.setPriority',
  setStatus: 'commandPalette.submenu.setStatus',
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
  const t = useTranslations();

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

  const baseActions = useMemo<ActionItem[]>(
    () => [
      {
        id: 'create-issue',
        keywords: ['create issue', 'new issue', 'add issue'],
        kind: 'action',
        label: t('commandPalette.actions.createIssue'),
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
        label: t('commandPalette.actions.goToSettings'),
        onSelect: () => {
          uiStore.closeCommandPalette();
          router.push(`/${workspaceKey}/settings`);
        },
      },
    ],
    [router, uiStore, workspaceKey, t],
  );
  const actionItems: ActionItem[] = query
    ? baseActions.filter(a => {
        const q = query.toLowerCase();
        return a.label.toLowerCase().includes(q) || a.keywords.some(k => k.includes(q));
      })
    : baseActions;

  const allItems: ResultItem[] = [...issueItems, ...actionItems];

  // Ref mutation during render — intentional: keeps parent's keyboard ref current
  // before any keydown event can fire. onItemsChange only mutates a useRef.
  onItemsChange(allItems);

  return (
    <>
      {allItems.length === 0 && (
        <p className="px-4 py-3 text-sm text-zinc-400">
          {t('commandPalette.noResultsFor', { query })}
        </p>
      )}

      {issueItems.length > 0 && (
        <>
          <p className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
            {query ? t('commandPalette.sections.issues') : t('commandPalette.sections.recent')}
          </p>
          {issueItems.map((item, i) => (
            <button
              aria-selected={i === activeIndex}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-2 text-sm',
                i === activeIndex ? 'bg-muted' : 'hover:bg-accent/50',
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
              <span className="flex-1 truncate text-foreground">{item.issue.title}</span>
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
            {t('commandPalette.sections.actions')}
          </p>
          {actionItems.map((item, i) => {
            const globalIdx = issueItems.length + i;
            return (
              <button
                aria-selected={globalIdx === activeIndex}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-sm',
                  globalIdx === activeIndex ? 'bg-muted' : 'hover:bg-accent/50',
                )}
                data-highlighted={globalIdx === activeIndex ? 'true' : undefined}
                data-idx={globalIdx}
                data-testid="command-palette-item"
                key={item.id}
                onClick={() => selectItem(item)}
                role="option"
                type="button"
              >
                <span className="flex-1 truncate text-foreground">{item.label}</span>
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
  onNavigate: (mode: SubMenuMode) => void;
  subMenu: SubMenuMode;
}

const SubMenuList = observer(function SubMenuList({
  activeIndex,
  onClose,
  onItemsChange,
  onNavigate,
  subMenu,
}: SubMenuListProps) {
  const { issueStore, labelStore, userStore, workflowStateStore } = useStore();
  const t = useTranslations();
  const applyPatch = useIssueUpdate();

  let subItems: SubMenuItem[] = [];

  if (subMenu.type === 'actions') {
    const { issueId } = subMenu;
    subItems = (
      [
        ['setStatus', 'commandPalette.submenu.setStatus'],
        ['setAssignee', 'commandPalette.submenu.setAssignee'],
        ['setPriority', 'commandPalette.submenu.setPriority'],
        ['setLabel', 'commandPalette.submenu.setLabel'],
      ] as const
    ).map(([type, labelKey]) => ({
      id: type,
      label: t(labelKey),
      onSelect: () => onNavigate({ issueId, type }),
    }));
  } else if (subMenu.type === 'setStatus') {
    const issue = issueStore.findById(subMenu.issueId);
    if (issue) {
      const states = workflowStateStore.findByTeamId(issue.teamId);
      subItems = states.map(s => ({
        id: s.id,
        label: s.name,
        onSelect: () => {
          applyPatch(subMenu.issueId, { stateId: s.id });
          onClose();
        },
      }));
    }
  } else if (subMenu.type === 'setAssignee') {
    const users = userStore.all;
    subItems = [
      {
        id: 'no-assignee',
        label: t('commandPalette.submenu.noAssignee'),
        onSelect: () => {
          applyPatch(subMenu.issueId, { assigneeId: null });
          onClose();
        },
      },
      ...users.map(u => ({
        id: u.id,
        label: u.displayName,
        onSelect: () => {
          applyPatch(subMenu.issueId, { assigneeId: u.id });
          onClose();
        },
      })),
    ];
  } else if (subMenu.type === 'setPriority') {
    subItems = ([0, 1, 2, 3, 4] as const).map(p => ({
      id: String(p),
      label: t(priorityLabelKey(p)),
      onSelect: () => {
        applyPatch(subMenu.issueId, { priority: p });
        onClose();
      },
    }));
  } else if (subMenu.type === 'setLabel') {
    const issue = issueStore.findById(subMenu.issueId);
    if (issue) {
      subItems = labelStore.all.map(l => ({
        id: l.id,
        label: l.name,
        onSelect: () => {
          const current = issue.labelIds ?? [];
          const next = current.includes(l.id)
            ? current.filter(id => id !== l.id)
            : [...current, l.id];
          applyPatch(subMenu.issueId, { labelIds: next });
          onClose();
        },
      }));
    }
  }

  // Ref mutation during render — intentional: see ResultsList above.
  onItemsChange(subItems);

  return (
    <>
      {subItems.length === 0 && (
        <p className="px-4 py-3 text-sm text-zinc-400">{t('commandPalette.submenu.noOptions')}</p>
      )}
      {subItems.map((item, i) => (
        <button
          aria-selected={i === activeIndex}
          className={cn(
            'flex w-full items-center gap-3 px-4 py-2 text-sm',
            i === activeIndex ? 'bg-muted' : 'hover:bg-accent/50',
          )}
          data-idx={i}
          key={item.id}
          onClick={item.onSelect}
          role="option"
          type="button"
        >
          <span className="text-foreground">{item.label}</span>
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
  const t = useTranslations();
  return (
    <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
      <span className="text-[10px] text-zinc-400">
        <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">↑↓</kbd>{' '}
        {t('commandPalette.footer.navigate')}
      </span>
      <span className="text-[10px] text-zinc-400">
        <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">↵</kbd>{' '}
        {t('commandPalette.footer.select')}
      </span>
      {!inSubMenu && (
        <span className="text-[10px] text-zinc-400">
          <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">Tab</kbd>{' '}
          {t('commandPalette.footer.issueActions')}
        </span>
      )}
      <span className="text-[10px] text-zinc-400">
        <kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-600">Esc</kbd>{' '}
        {inSubMenu ? t('commandPalette.footer.back') : t('commandPalette.footer.close')}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// CommandPaletteContent — non-observer, owns all state + keyboard nav
// ---------------------------------------------------------------------------

function CommandPaletteContent({ recentItems }: { recentItems: RecentItem[] }) {
  const { uiStore } = useStore();
  const t = useTranslations();
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

  const onAllItemsChange = useCallback((items: ResultItem[]) => {
    allItemsRef.current = items;
  }, []);

  const onSubItemsChange = useCallback((items: SubMenuItem[]) => {
    subItemsRef.current = items;
  }, []);

  const onPaletteClose = useCallback(() => uiStore.closeCommandPalette(), [uiStore]);

  const inSubMenu = subMenu.type !== 'none';

  // Keep a ref with the latest handler state so the event listener registered
  // once below can always read fresh values without being re-registered.
  const keyStateRef = useRef({
    activeIndex,
    allItemsRef,
    clampIndex,
    inSubMenu,
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
    inSubMenu,
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
      } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
        if (e.key === 'Tab') {
          // Focus never leaves the palette — it isn't a native modal, so an
          // unhandled Tab would move focus to the page underneath.
          e.preventDefault();
        } else {
          // ArrowRight opens issue actions only when it can't be a caret
          // move: skip while the caret is anywhere but the end of the query.
          const input = inputRef.current;
          if (
            input &&
            document.activeElement === input &&
            input.selectionStart !== input.value.length
          ) {
            return;
          }
        }
        if (!inSub) {
          const target = idx === -1 ? allRef.current[0] : allRef.current[idx];
          if (target?.kind === 'issue') {
            e.preventDefault();
            setSub({ issueId: target.issue.id, type: 'actions' });
            setIdx(0);
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (inSub) {
          // Leaf submenus step back to the actions list; actions closes to
          // the main results. keyStateRef only tracks a boolean, so read the
          // concrete mode from the state setter to decide.
          setSub(prev =>
            prev.type === 'none' || prev.type === 'actions'
              ? { type: 'none' }
              : { issueId: prev.issueId, type: 'actions' },
          );
          setIdx(0);
        } else {
          ui.closeCommandPalette();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div aria-hidden="true" className="fixed inset-0 z-50 bg-black/30" onClick={onPaletteClose} />

      {/* Dialog */}
      <div
        aria-label={t('commandPalette.dialogAriaLabel')}
        aria-modal="true"
        className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        data-testid="command-palette"
        role="dialog"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {inSubMenu && (
            <button
              aria-label={t('commandPalette.footer.back')}
              className="flex-shrink-0 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={() => {
                setSubMenu({ type: 'none' });
                setActiveIndex(0);
              }}
              type="button"
            >
              ← {t('commandPalette.footer.back')}
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
                ? t(
                    SUBMENU_PLACEHOLDER_KEYS[
                      subMenu.type as keyof typeof SUBMENU_PLACEHOLDER_KEYS
                    ] ?? 'commandPalette.searchAriaLabel',
                  )
                : t('commandPalette.searchAriaLabel')
            }
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
            onChange={e => setQuery(e.target.value)}
            placeholder={
              inSubMenu
                ? t(
                    SUBMENU_PLACEHOLDER_KEYS[
                      subMenu.type as keyof typeof SUBMENU_PLACEHOLDER_KEYS
                    ] ?? 'commandPalette.searchPlaceholder',
                  )
                : t('commandPalette.searchPlaceholder')
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
              onClose={onPaletteClose}
              onItemsChange={onSubItemsChange}
              onNavigate={mode => {
                setSubMenu(mode);
                setActiveIndex(0);
              }}
              subMenu={subMenu}
            />
          ) : (
            <ResultsList
              activeIndex={activeIndex}
              onItemsChange={onAllItemsChange}
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

export default CommandPalette;
