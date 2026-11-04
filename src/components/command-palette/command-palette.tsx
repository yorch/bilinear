'use client';

import { Check } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams, usePathname, useRouter } from 'next/navigation';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { ColorDot } from '@/components/ui/color-dot';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import type { RecentItem } from '@/hooks/use-recent-items';
import { type Theme, useTheme } from '@/hooks/use-theme';
import { useTranslations } from '@/hooks/use-translations';
import { ACCENT_DEFINITIONS, type AccentDefinition } from '@/lib/accent';
import type { DBIssue } from '@/lib/db';
import { IDENTIFIER_RE } from '@/lib/identifiers';
import { buildIssueHref } from '@/lib/issue-nav';
import { cn } from '@/lib/utils';
import { useAccent } from '@/providers/accent-provider';
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
/** A navigable entity (team, project, doc, saved view) found by name. */
type NavItem = {
  href: string;
  id: string;
  kind: 'nav';
  label: string;
  section: 'docs' | 'projects' | 'teams' | 'views';
  /** Muted trailing text — the team key or the owning team's name. */
  hint?: string;
};
type ResultItem = IssueItem | ActionItem | NavItem;

const NAV_SECTION_LABEL_KEYS = {
  docs: 'commandPalette.sections.docs',
  projects: 'commandPalette.sections.projects',
  teams: 'commandPalette.sections.teams',
  views: 'commandPalette.sections.views',
} as const;

/** Per-group cap so a broad query ("e") doesn't bury the other groups. */
const NAV_GROUP_LIMIT = 5;

type SubMenuMode =
  | { type: 'none' }
  | { issueId: string; type: 'actions' }
  | { issueId: string; type: 'setStatus' }
  | { issueId: string; type: 'setAssignee' }
  | { issueId: string; type: 'setPriority' }
  | { issueId: string; type: 'setLabel' };

type SubMenuItem = {
  /** True for the issue's current value — rendered with a check mark. */
  current?: boolean;
  id: string;
  label: string;
  onSelect: () => void;
};

const SUBMENU_PLACEHOLDER_KEYS = {
  actions: 'commandPalette.submenu.actions',
  setAssignee: 'commandPalette.submenu.setAssignee',
  setLabel: 'commandPalette.submenu.setLabel',
  setPriority: 'commandPalette.submenu.setPriority',
  setStatus: 'commandPalette.submenu.setStatus',
} satisfies Record<Exclude<SubMenuMode['type'], 'none'>, string>;

// ---------------------------------------------------------------------------
// PaletteRow — the one option row. Focus stays in the input; the row is a
// plain `role="option"` that the input points at via aria-activedescendant,
// so it must not be a focusable <button>.
// ---------------------------------------------------------------------------

function optionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

interface PaletteRowProps {
  active: boolean;
  children: React.ReactNode;
  idx: number;
  listId: string;
  onHover: (idx: number) => void;
  onSelect: () => void;
  testId?: string;
}

function PaletteRow({ active, children, idx, listId, onHover, onSelect, testId }: PaletteRowProps) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled on the combobox input (aria-activedescendant)
    <div
      aria-selected={active}
      className={cn(
        'flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm',
        active && 'bg-muted',
      )}
      data-highlighted={active ? 'true' : undefined}
      data-idx={idx}
      data-testid={testId}
      id={optionId(listId, idx)}
      onClick={onSelect}
      onMouseMove={() => onHover(idx)}
      role="option"
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <p
      className="px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      id={id}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// ResultsList — observer: issueStore + workflowStateStore + teamStore
// ---------------------------------------------------------------------------

interface ResultsListProps {
  activeIndex: number;
  listId: string;
  onHover: (idx: number) => void;
  onItemsChange: (items: ResultItem[]) => void;
  query: string;
  recentItems: RecentItem[];
  router: ReturnType<typeof useRouter>;
  selectItem: (item: ResultItem | undefined) => void;
  workspaceKey: string;
}

const ResultsList = observer(function ResultsList({
  activeIndex,
  listId,
  onHover,
  onItemsChange,
  query,
  recentItems,
  router,
  selectItem,
  workspaceKey,
}: ResultsListProps) {
  const {
    customViewStore,
    documentStore,
    issueStore,
    projectStore,
    teamStore,
    uiStore,
    workflowStateStore,
  } = useStore();
  const t = useTranslations();
  const { setTheme } = useTheme();
  const { setAccent } = useAccent();

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
  const allIssueItems: IssueItem[] = issues.map(issue => ({
    issue,
    kind: 'issue' as const,
    stateColor: workflowStateStore.findById(issue.stateId)?.color,
    teamKey: teamStore.findById(issue.teamId)?.key ?? '',
  }));

  const baseActions = useMemo<ActionItem[]>(() => {
    const goTo = (id: string, keywords: string[], labelKey: string, path: string): ActionItem => ({
      id,
      keywords,
      kind: 'action',
      label: t(labelKey),
      onSelect: () => {
        uiStore.closeCommandPalette();
        router.push(`/${workspaceKey}${path}`);
      },
    });
    const switchAccent = (definition: AccentDefinition): ActionItem => ({
      id: `accent-${definition.id}`,
      keywords: ['accent', 'colour', 'color', 'appearance', 'brand', definition.id],
      kind: 'action',
      label: t('commandPalette.actions.switchAccent', { accent: t(definition.labelKey) }),
      onSelect: () => {
        uiStore.closeCommandPalette();
        setAccent(definition.id);
      },
    });
    const switchTheme = (id: string, theme: Theme, themeLabelKey: string): ActionItem => ({
      id,
      keywords: ['theme', 'appearance', theme],
      kind: 'action',
      label: t('commandPalette.actions.switchTheme', { theme: t(themeLabelKey) }),
      onSelect: () => {
        uiStore.closeCommandPalette();
        setTheme(theme);
      },
    });

    return [
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
        id: 'create-project',
        keywords: ['create project', 'new project', 'add project'],
        kind: 'action',
        label: t('commandPalette.actions.createProject'),
        onSelect: () => {
          uiStore.closeCommandPalette();
          router.push(`/${workspaceKey}/projects`);
          uiStore.openCreateProjectModal();
        },
      },
      {
        id: 'create-team',
        keywords: ['create team', 'new team', 'add team'],
        kind: 'action',
        label: t('commandPalette.actions.createTeam'),
        onSelect: () => {
          uiStore.closeCommandPalette();
          uiStore.openCreateTeamModal();
        },
      },
      goTo('go-my-issues', ['my issues'], 'commandPalette.actions.goToMyIssues', '/my-issues'),
      goTo('go-inbox', ['inbox', 'notifications'], 'commandPalette.actions.goToInbox', '/inbox'),
      goTo('go-projects', ['projects'], 'commandPalette.actions.goToProjects', '/projects'),
      goTo(
        'go-initiatives',
        ['initiatives'],
        'commandPalette.actions.goToInitiatives',
        '/initiatives',
      ),
      goTo(
        'go-analytics',
        ['analytics', 'insights'],
        'commandPalette.actions.goToAnalytics',
        '/analytics',
      ),
      goTo(
        'go-settings',
        ['settings', 'preferences', 'config'],
        'commandPalette.actions.goToSettings',
        '/settings',
      ),
      goTo(
        'go-settings-members',
        ['members', 'people', 'invite', 'settings'],
        'commandPalette.actions.goToMembers',
        '/settings',
      ),
      goTo(
        'go-settings-integrations',
        ['integrations', 'github', 'slack', 'settings'],
        'commandPalette.actions.goToIntegrations',
        '/settings/integrations',
      ),
      goTo(
        'go-settings-security',
        ['security', 'sso', 'saml', 'settings'],
        'commandPalette.actions.goToSecurity',
        '/settings/security',
      ),
      goTo(
        'go-settings-webhooks',
        ['webhooks', 'settings'],
        'commandPalette.actions.goToWebhooks',
        '/settings/webhooks',
      ),
      goTo(
        'go-settings-import',
        ['import', 'export', 'csv', 'settings'],
        'commandPalette.actions.goToImportExport',
        '/settings/import',
      ),
      goTo(
        'go-settings-roadmap',
        ['roadmap', 'settings'],
        'commandPalette.actions.goToRoadmap',
        '/settings/roadmap',
      ),
      goTo(
        'go-settings-automations',
        ['automations', 'rules', 'settings'],
        'commandPalette.actions.goToAutomations',
        '/settings/automations',
      ),
      goTo(
        'go-settings-audit-log',
        ['audit', 'log', 'history', 'settings'],
        'commandPalette.actions.goToAuditLog',
        '/settings/audit-log',
      ),
      {
        id: 'keyboard-shortcuts',
        keywords: ['keyboard', 'shortcuts', 'hotkeys', 'help'],
        kind: 'action',
        label: t('commandPalette.actions.keyboardShortcuts'),
        onSelect: () => {
          uiStore.closeCommandPalette();
          uiStore.openShortcutHelp();
        },
        shortcut: '?',
      },
      switchTheme('theme-light', 'light', 'theme.light'),
      switchTheme('theme-dark', 'dark', 'theme.dark'),
      switchTheme('theme-system', 'system', 'theme.system'),
      ...ACCENT_DEFINITIONS.map(switchAccent),
    ];
  }, [router, uiStore, workspaceKey, t, setTheme, setAccent]);
  const actionItems: ActionItem[] = query
    ? baseActions.filter(a => {
        const q = query.toLowerCase();
        return a.label.toLowerCase().includes(q) || a.keywords.some(k => k.includes(q));
      })
    : baseActions;

  // Teams, projects, docs and saved views — read from the local pools, so the
  // palette navigates the whole workspace and not just its issues.
  const navItems: NavItem[] = [];
  const needle = (query || '').trim().toLowerCase();
  if (needle) {
    const matches = (...fields: Array<string | null | undefined>) =>
      fields.some(f => f?.toLowerCase().includes(needle));
    const base = `/${workspaceKey}`;
    navItems.push(
      ...teamStore.all
        .filter(team => matches(team.name, team.displayName, team.key))
        .slice(0, NAV_GROUP_LIMIT)
        .map(
          (team): NavItem => ({
            hint: team.key,
            href: `${base}/team/${team.key}`,
            id: `team-${team.id}`,
            kind: 'nav',
            label: team.displayName || team.name,
            section: 'teams',
          }),
        ),
      ...projectStore.all
        .filter(project => matches(project.name))
        .slice(0, NAV_GROUP_LIMIT)
        .map(
          (project): NavItem => ({
            href: `${base}/project/${project.slugId}`,
            id: `project-${project.id}`,
            kind: 'nav',
            label: project.name,
            section: 'projects',
          }),
        ),
      ...documentStore.all
        .filter(doc => matches(doc.title))
        .slice(0, NAV_GROUP_LIMIT)
        .map(
          (doc): NavItem => ({
            href: `${base}/docs/${doc.id}`,
            id: `doc-${doc.id}`,
            kind: 'nav',
            label: doc.title,
            section: 'docs',
          }),
        ),
    );
    // A workspace-scoped view has no team, hence no route — skip it, as the
    // sidebar's favorites do.
    for (const view of customViewStore.all) {
      if (navItems.filter(n => n.section === 'views').length >= NAV_GROUP_LIMIT) {
        break;
      }
      const teamKey = view.teamId ? teamStore.findById(view.teamId)?.key : undefined;
      if (teamKey && matches(view.name)) {
        navItems.push({
          hint: teamKey,
          href: `${base}/team/${teamKey}/view/${view.id}`,
          id: `view-${view.id}`,
          kind: 'nav',
          label: view.name,
          section: 'views',
        });
      }
    }
  }

  // Teams/projects/docs sit below the issues in a short scrolling list; when
  // any matched, trim the issues so those groups are not pushed out of view.
  const issueItems = allIssueItems.slice(0, navItems.length > 0 ? 5 : allIssueItems.length);

  const allItems: ResultItem[] = [...issueItems, ...navItems, ...actionItems];

  // Publish the item list to the parent AFTER commit (layout effect, so it is
  // still current before any keydown can fire). Doing it during render left
  // the parent's aria-activedescendant one render behind.
  useLayoutEffect(() => {
    onItemsChange(allItems);
  });

  const navSections = (['teams', 'projects', 'docs', 'views'] as const).filter(section =>
    navItems.some(n => n.section === section),
  );

  return (
    <>
      {allItems.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t('commandPalette.noResultsFor', { query })}
        </p>
      )}

      {issueItems.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: a listbox may only contain option/group children; <fieldset> is not valid there
        <div aria-labelledby={`${listId}-sec-issues`} role="group">
          <SectionLabel id={`${listId}-sec-issues`}>
            {query ? t('commandPalette.sections.issues') : t('commandPalette.sections.recent')}
          </SectionLabel>
          {issueItems.map((item, i) => (
            <PaletteRow
              active={i === activeIndex}
              idx={i}
              key={item.issue.id}
              listId={listId}
              onHover={onHover}
              onSelect={() => selectItem(item)}
              testId="command-palette-item"
            >
              {item.stateColor && <ColorDot color={item.stateColor} />}
              <span className="w-16 flex-shrink-0 font-mono text-xs text-muted-foreground">
                {item.issue.identifier}
              </span>
              <span className="flex-1 truncate text-foreground">{item.issue.title}</span>
            </PaletteRow>
          ))}
        </div>
      )}

      {navSections.map(section => (
        // biome-ignore lint/a11y/useSemanticElements: see the issues group above
        <div aria-labelledby={`${listId}-sec-${section}`} key={section} role="group">
          <SectionLabel id={`${listId}-sec-${section}`}>
            {t(NAV_SECTION_LABEL_KEYS[section])}
          </SectionLabel>
          {navItems.map((item, i) => {
            if (item.section !== section) {
              return null;
            }
            const globalIdx = issueItems.length + i;
            return (
              <PaletteRow
                active={globalIdx === activeIndex}
                idx={globalIdx}
                key={item.id}
                listId={listId}
                onHover={onHover}
                onSelect={() => selectItem(item)}
                testId="command-palette-item"
              >
                <span className="flex-1 truncate text-foreground">{item.label}</span>
                {item.hint && (
                  <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                )}
              </PaletteRow>
            );
          })}
        </div>
      ))}

      {actionItems.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: see the issues group above
        <div aria-labelledby={`${listId}-sec-actions`} role="group">
          <SectionLabel id={`${listId}-sec-actions`}>
            {t('commandPalette.sections.actions')}
          </SectionLabel>
          {actionItems.map((item, i) => {
            const globalIdx = issueItems.length + navItems.length + i;
            return (
              <PaletteRow
                active={globalIdx === activeIndex}
                idx={globalIdx}
                key={item.id}
                listId={listId}
                onHover={onHover}
                onSelect={() => selectItem(item)}
                testId="command-palette-item"
              >
                <span className="flex-1 truncate text-foreground">{item.label}</span>
                {item.shortcut && (
                  <kbd className="flex-shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {item.shortcut}
                  </kbd>
                )}
              </PaletteRow>
            );
          })}
        </div>
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// SubMenuList — observer: issueStore + workflowStateStore + userStore + labelStore
// ---------------------------------------------------------------------------

interface SubMenuListProps {
  activeIndex: number;
  listId: string;
  onClose: () => void;
  onHover: (idx: number) => void;
  onItemsChange: (items: SubMenuItem[]) => void;
  onNavigate: (mode: SubMenuMode) => void;
  query: string;
  subMenu: SubMenuMode;
}

const SubMenuList = observer(function SubMenuList({
  activeIndex,
  listId,
  onClose,
  onHover,
  onItemsChange,
  onNavigate,
  query,
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
        current: s.id === issue.stateId,
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
    const currentAssigneeId = issueStore.findById(subMenu.issueId)?.assigneeId ?? null;
    subItems = [
      {
        current: currentAssigneeId === null,
        id: 'no-assignee',
        label: t('commandPalette.submenu.noAssignee'),
        onSelect: () => {
          applyPatch(subMenu.issueId, { assigneeId: null });
          onClose();
        },
      },
      ...users.map(u => ({
        current: u.id === currentAssigneeId,
        id: u.id,
        label: u.displayName,
        onSelect: () => {
          applyPatch(subMenu.issueId, { assigneeId: u.id });
          onClose();
        },
      })),
    ];
  } else if (subMenu.type === 'setPriority') {
    const currentPriority = issueStore.findById(subMenu.issueId)?.priority;
    subItems = ([0, 1, 2, 3, 4] as const).map(p => ({
      current: p === currentPriority,
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
        current: (issue.labelIds ?? []).includes(l.id),
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

  // The input filters the sub-menu too (it used to ignore the query entirely).
  const needle = query.trim().toLowerCase();
  if (needle) {
    subItems = subItems.filter(item => item.label.toLowerCase().includes(needle));
  }

  // Published after commit: see ResultsList above.
  useLayoutEffect(() => {
    onItemsChange(subItems);
  });

  return (
    <>
      {subItems.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t('commandPalette.submenu.noOptions')}
        </p>
      )}
      {subItems.map((item, i) => (
        <PaletteRow
          active={i === activeIndex}
          idx={i}
          key={item.id}
          listId={listId}
          onHover={onHover}
          onSelect={item.onSelect}
        >
          <span className="flex-1 text-foreground">{item.label}</span>
          {item.current && (
            <>
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-brand" />
              <span className="sr-only">{t('commandPalette.submenu.current')}</span>
            </>
          )}
        </PaletteRow>
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
    <div className="flex items-center gap-4 border-t border-border px-4 py-2 max-md:hidden">
      <span className="text-[10px] text-muted-foreground">
        <kbd className="rounded border border-border px-1">↑↓</kbd>{' '}
        {t('commandPalette.footer.navigate')}
      </span>
      <span className="text-[10px] text-muted-foreground">
        <kbd className="rounded border border-border px-1">↵</kbd>{' '}
        {t('commandPalette.footer.select')}
      </span>
      {!inSubMenu && (
        <span className="text-[10px] text-muted-foreground">
          <kbd className="rounded border border-border px-1">Tab</kbd>{' '}
          {t('commandPalette.footer.issueActions')}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground">
        <kbd className="rounded border border-border px-1">Esc</kbd>{' '}
        {inSubMenu ? t('commandPalette.footer.back') : t('commandPalette.footer.close')}
      </span>
    </div>
  );
});

// ---------------------------------------------------------------------------
// CommandPaletteContent — non-observer, owns all state + keyboard nav
// ---------------------------------------------------------------------------

function CommandPaletteContent({ recentItems }: { recentItems: RecentItem[] }) {
  const { issueStore, uiStore } = useStore();
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace ?? '';

  const [query, setQuery] = useState('');
  // Start on the first row: Enter runs it, so it should look selected.
  const [activeIndex, setActiveIndex] = useState(0);
  const [subMenu, setSubMenu] = useState<SubMenuMode>({ type: 'none' });
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Refs holding latest item arrays for the keyboard handler — updated by
  // child observers during their renders, not from this component
  const allItemsRef = useRef<ResultItem[]>([]);
  const subItemsRef = useRef<SubMenuItem[]>([]);
  // How many options the visible list actually rendered, set from the
  // children's layout effects so aria-activedescendant never lags a render.
  const [optionCount, setOptionCount] = useState(0);
  // The root-level query, stashed on entering an issue sub-menu so backing out
  // restores the search instead of dropping to the Recent list.
  const rootQueryRef = useRef('');

  useEffect(() => {
    setQuery('');
    setActiveIndex(0);
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
      if (item.kind === 'nav') {
        router.push(item.href);
        uiStore.closeCommandPalette();
      } else if (item.kind === 'issue') {
        const href = buildIssueHref(workspaceKey, item.issue.id, {
          label: t('commandPalette.footer.back'),
          path: pathname,
        });
        router.push(href);
        uiStore.closeCommandPalette();
      } else {
        item.onSelect();
      }
    },
    [router, workspaceKey, uiStore, pathname, t],
  );

  const onAllItemsChange = useCallback((items: ResultItem[]) => {
    allItemsRef.current = items;
    setOptionCount(items.length);
  }, []);

  const onSubItemsChange = useCallback((items: SubMenuItem[]) => {
    subItemsRef.current = items;
    setOptionCount(items.length);
  }, []);

  const onPaletteClose = useCallback(() => uiStore.closeCommandPalette(), [uiStore]);

  const inSubMenu = subMenu.type !== 'none';
  const subMenuIssue = subMenu.type !== 'none' ? issueStore.findById(subMenu.issueId) : null;
  // aria-activedescendant must point at an element that exists.
  const hasActiveOption = activeIndex >= 0 && activeIndex < optionCount;

  // Keep a ref with the latest handler state so the event listener registered
  // once below can always read fresh values without being re-registered.
  const keyStateRef = useRef({
    activeIndex,
    allItemsRef,
    clampIndex,
    inSubMenu,
    query,
    rootQueryRef,
    selectItem,
    setActiveIndex,
    setQuery,
    setSubMenu,
    subItemsRef,
    subType: subMenu.type,
    uiStore,
  });
  keyStateRef.current = {
    activeIndex,
    allItemsRef,
    clampIndex,
    inSubMenu,
    query,
    rootQueryRef,
    selectItem,
    setActiveIndex,
    setQuery,
    setSubMenu,
    subItemsRef,
    subType: subMenu.type,
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
        query: currentQuery,
        rootQueryRef: rootRef,
        selectItem: select,
        setActiveIndex: setIdx,
        setQuery: setQ,
        setSubMenu: setSub,
        subItemsRef: subRef,
        subType,
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
        if (e.isComposing) {
          // An IME commit, not a command.
          return;
        }
        e.preventDefault();
        if (inSub) {
          subRef.current[idx]?.onSelect();
        } else {
          select(allRef.current[idx] ?? allRef.current[0]);
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
          const target = allRef.current[idx] ?? allRef.current[0];
          if (target?.kind === 'issue') {
            e.preventDefault();
            rootRef.current = currentQuery;
            setSub({ issueId: target.issue.id, type: 'actions' });
            setQ('');
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
          // Back at the root list: restore the search the user left.
          setQ(subType === 'actions' ? rootRef.current : '');
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
        className="fixed left-1/2 top-[10%] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card shadow-e3 md:top-[20%]"
        data-testid="command-palette"
        role="dialog"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {inSubMenu && subMenuIssue && (
            <span className="flex-shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {subMenuIssue.identifier}
            </span>
          )}
          {inSubMenu && (
            <button
              aria-label={t('commandPalette.footer.back')}
              className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground-secondary"
              onClick={() => {
                setSubMenu({ type: 'none' });
                setQuery(rootQueryRef.current);
                setActiveIndex(0);
                inputRef.current?.focus();
              }}
              type="button"
            >
              ← {t('commandPalette.footer.back')}
            </button>
          )}
          <svg
            aria-hidden="true"
            className="h-4 w-4 flex-shrink-0 text-muted-foreground"
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
            aria-activedescendant={hasActiveOption ? optionId(listId, activeIndex) : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
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
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            onChange={e => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
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
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
          />
        </div>

        {/* Results */}
        <div
          className="max-h-80 overflow-y-auto py-1"
          data-testid="command-palette-results"
          id={listId}
          ref={listRef}
          role="listbox"
        >
          {inSubMenu ? (
            <SubMenuList
              activeIndex={activeIndex}
              listId={listId}
              onClose={onPaletteClose}
              onHover={setActiveIndex}
              onItemsChange={onSubItemsChange}
              onNavigate={mode => {
                setSubMenu(mode);
                setQuery('');
                setActiveIndex(0);
              }}
              query={query}
              subMenu={subMenu}
            />
          ) : (
            <ResultsList
              activeIndex={activeIndex}
              listId={listId}
              onHover={setActiveIndex}
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
