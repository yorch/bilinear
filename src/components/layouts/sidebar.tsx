'use client';

import {
  Archive,
  BarChart2,
  BookOpen,
  ChevronRight,
  Eye,
  FileText,
  Flag,
  Inbox,
  Keyboard,
  Layers,
  LogOut,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Target,
  User,
  Users,
  X,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AccentToggle } from '@/components/accent-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { ConnectionStatus } from '@/components/layouts/connection-status';
import { WorkspaceSwitcher } from '@/components/layouts/workspace-switcher';
import { InlineRetry } from '@/components/shared/inline-retry';
import { ThemeToggle } from '@/components/theme-toggle';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/hooks/use-auth';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlQuery } from '@/lib/graphql';
import { FAVORITE_DELETE_MUTATION, FAVORITES_QUERY } from '@/lib/graphql-queries';
import { isPathWithin } from '@/lib/issue-nav';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useAppName } from '@/providers/branding-provider';
import { useStore } from '@/providers/store-provider';

interface FavoriteMeta {
  entity:
    | { __typename: 'Issue'; id: string; identifier: string; title: string; teamId: string }
    | {
        __typename: 'Project';
        id: string;
        name: string;
        icon?: string | null;
        color?: string | null;
        slugId: string;
      }
    | { __typename: 'Initiative'; id: string; name: string; color?: string | null }
    | { __typename: 'CustomView'; id: string; name: string; customViewTeamId: string | null }
    | {
        __typename: 'Cycle';
        id: string;
        number: number;
        cycleName: string | null;
        teamId: string;
      }
    | { __typename: 'Document'; id: string; title: string; documentTeamId: string | null }
    | { __typename: 'Team'; id: string; name: string; key: string; icon?: string | null }
    | null;
  entityType: string;
  id: string;
  sortOrder: number;
}

function favoriteIcon(entityType: string) {
  switch (entityType) {
    case 'Issue':
      return <Layers className="h-3 w-3" />;
    case 'Project':
      return <Target className="h-3 w-3" />;
    case 'Initiative':
      return <Flag className="h-3 w-3" />;
    case 'CustomView':
      return <Eye className="h-3 w-3" />;
    case 'Cycle':
      return <RefreshCw className="h-3 w-3" />;
    case 'Document':
      return <BookOpen className="h-3 w-3" />;
    case 'Team':
      return <Users className="h-3 w-3" />;
    default:
      return <Star className="h-3 w-3" />;
  }
}

type Translate = ReturnType<typeof useTranslations>;

function favoriteLabel(fav: FavoriteMeta, t: Translate): string {
  const e = fav.entity;
  if (!e) {
    return '';
  }
  switch (e.__typename) {
    case 'Issue':
      return `${e.identifier} ${e.title}`;
    case 'Document':
      return e.title;
    // Cycles are frequently unnamed — fall back to the numbered label the rest
    // of the cycle UI uses.
    case 'Cycle':
      return e.cycleName || t('cycles.defaultName', { number: e.number });
    default:
      return e.name;
  }
}

function favoriteHref(
  fav: FavoriteMeta,
  base: string,
  findTeamById: (id: string | null) => { key: string } | null | undefined,
): string {
  const e = fav.entity;
  if (!e) {
    return '#';
  }
  switch (e.__typename) {
    case 'Issue':
      return `${base}/issue/${e.id}`;
    case 'Project':
      return `${base}/project/${e.slugId}`;
    case 'Initiative':
      return `${base}/initiatives`;
    // A workspace-scoped custom view has no team, and there is no team-less view
    // route — fall through to '#' the same way an unresolvable team does.
    case 'CustomView': {
      const key = findTeamById(e.customViewTeamId)?.key;
      return key ? `${base}/team/${key}/view/${e.id}` : '#';
    }
    case 'Cycle': {
      const key = findTeamById(e.teamId)?.key;
      return key ? `${base}/team/${key}/cycles` : '#';
    }
    case 'Document':
      return `${base}/docs/${e.id}`;
    case 'Team':
      return `${base}/team/${e.key}`;
    default:
      return '#';
  }
}

// ─── Favorites section ────────────────────────────────────────────────────────

const SidebarFavoritesSection = observer(function SidebarFavoritesSection({
  base,
  collapsed,
  onNavigate,
  pathname,
}: {
  base: string;
  collapsed: boolean;
  onNavigate?: () => void;
  pathname: string;
}) {
  const { favoriteStore, teamStore } = useStore();
  const t = useTranslations();
  // Derive a stable string from the MobX store that changes on any insert,
  // delete, or sortOrder update so the sidebar re-fetches full entity data.
  const favStoreKey = favoriteStore.all.map(f => `${f.id}:${f.sortOrder}`).join(',');

  // A failed read must not unmount the entire Favorites section — exactly the
  // handling that hid a real query bug for a long time.
  const {
    data: favorites,
    error: loadError,
    refetch: fetchFavorites,
    setData: setFavorites,
  } = useRetryableFetch<FavoriteMeta[]>(
    async () => {
      const list = await gqlQuery<FavoriteMeta[] | null>(FAVORITES_QUERY, {}, 'favorites');
      return (list ?? []).filter(f => f.entity !== null).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    [favStoreKey],
    [],
  );

  async function removeFavorite(id: string) {
    try {
      const res = await gql(FAVORITE_DELETE_MUTATION, { id });
      if (res.errors?.length) {
        toast.error(t('nav.failedToRemoveFavorite'));
      } else {
        setFavorites(prev => prev.filter(f => f.id !== id));
      }
    } catch {
      toast.error(t('nav.failedToRemoveFavorite'));
    }
  }

  if (collapsed || (favorites.length === 0 && !loadError)) {
    return null;
  }

  return (
    <div className="mt-4 px-1.5">
      <div className="mb-1 flex items-center px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('nav.favorites')}
        </span>
      </div>
      {loadError && (
        <InlineRetry
          className="flex-wrap px-2 py-1"
          message={t('common.somethingWentWrong')}
          onRetry={fetchFavorites}
        />
      )}
      <ul className="flex flex-col gap-0.5">
        {favorites.map(fav => {
          const href = favoriteHref(fav, base, id => (id ? teamStore.findById(id) : null));
          const label = favoriteLabel(fav, t);
          const isActive = pathname === href;
          return (
            <li className="group flex items-center" key={fav.id}>
              <Link
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-brand-subtle text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                href={href}
                onClick={onNavigate}
                title={label}
              >
                <span className="shrink-0 text-muted-foreground">
                  {favoriteIcon(fav.entityType)}
                </span>
                <span className="truncate text-xs">{label}</span>
              </Link>
              <button
                aria-label={t('nav.removeNamedFromFavorites', { name: label })}
                className={cn(
                  'mr-1 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:flex',
                  TOUCH_TARGET,
                )}
                onClick={() => void removeFavorite(fav.id)}
                title={t('nav.removeFromFavorites')}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

// ─── Teams section ────────────────────────────────────────────────────────────

/** One row under an expanded team. Was copy-pasted five times inline. */
function TeamSubLink({
  active,
  href,
  icon,
  label,
  onNavigate,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
  onNavigate?: () => void;
}) {
  return (
    <Link
      className={cn(
        'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
        active
          ? 'bg-brand-subtle text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      href={href}
      onClick={onNavigate}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

const SidebarTeamsSection = observer(function SidebarTeamsSection({
  base,
  collapsed,
  onNavigate,
  pathname,
}: {
  base: string;
  collapsed: boolean;
  onNavigate?: () => void;
  pathname: string;
}) {
  const { customViewStore, teamStore, uiStore } = useStore();
  const t = useTranslations();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
  const teams = useMemo(() => {
    const allTeams = teamStore.all;
    const rootTeams = allTeams.filter(t => !t.parentId);
    const childTeamsByParent = allTeams.reduce<Record<string, typeof allTeams>>((acc, t) => {
      if (t.parentId) {
        if (!acc[t.parentId]) {
          acc[t.parentId] = [];
        }
        acc[t.parentId].push(t);
      }
      return acc;
    }, {});
    return rootTeams.flatMap(t => [t, ...(childTeamsByParent[t.id] ?? [])]);
  }, [teamStore.pool.size]);

  /**
   * Which teams show their sub-links.
   *
   * Every team used to render all five (backlog, cycles, analytics, docs, plus
   * each saved view) permanently — 25+ nav rows before favourites at four
   * teams, which buried the global nav above it. Only the team you are
   * actually in is expanded now; the rest collapse to a single row.
   */
  const activeTeamKey = teams.find(team => isPathWithin(pathname, `${base}/team/${team.key}`))?.key;
  const [manuallyToggled, setManuallyToggled] = useState<Record<string, boolean>>({});

  // Exactly one team is open by default: the one the route is in, or — on a
  // non-team route like the workspace root, my-issues or inbox — the first
  // team, so the sub-nav is never entirely absent and the sub-routes stay
  // reachable without a click to discover them.
  const defaultExpandedKey = activeTeamKey ?? teams[0]?.key;

  // The default team is expanded unless the user explicitly collapsed it; any
  // other team stays closed unless they explicitly opened it. Keeping the
  // override keyed by team (rather than tracking an open set) means navigating
  // to a new team expands it without fighting a previous manual choice.
  const isExpanded = (key: string) => manuallyToggled[key] ?? key === defaultExpandedKey;

  return (
    <>
      {/* Expanded teams list */}
      {!collapsed && (
        <div className="mt-4 px-1.5">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('nav.teams')}
            </span>
            <button
              aria-label={t('nav.newTeam')}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => uiStore.openCreateTeamModal()}
              title={t('nav.newTeam')}
              type="button"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <ul className="flex flex-col gap-0.5">
            {teams.length === 0 ? (
              <li>
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => uiStore.openCreateTeamModal()}
                  type="button"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('nav.createTeam')}
                </button>
              </li>
            ) : (
              teams.map(team => {
                const isChild = !!team.parentId;
                const href = `${base}/team/${team.key}`;
                const cyclesHref = `${href}/cycles`;
                const backlogHref = `${href}/backlog`;
                const docsHref = `${href}/docs`;
                const triageHref = `${href}/triage`;
                const viewHrefPrefix = `${href}/view/`;
                const analyticsHref = `${href}/analytics`;
                const isActive =
                  isPathWithin(pathname, href) &&
                  !pathname.startsWith(cyclesHref) &&
                  !pathname.startsWith(backlogHref) &&
                  !pathname.startsWith(docsHref) &&
                  !pathname.startsWith(triageHref) &&
                  !pathname.startsWith(analyticsHref) &&
                  !pathname.startsWith(viewHrefPrefix);
                const isCyclesActive = pathname.startsWith(cyclesHref);
                const isBacklogActive = pathname.startsWith(backlogHref);
                const isDocsActive = pathname.startsWith(docsHref);
                const isTriageActive = pathname.startsWith(triageHref);
                const isAnalyticsActive = pathname.startsWith(analyticsHref);
                const expanded = isExpanded(team.key);
                return (
                  <li className={cn('flex flex-col gap-0.5', isChild && 'ml-3')} key={team.id}>
                    <div className="flex items-center gap-0.5">
                      <button
                        aria-expanded={expanded}
                        aria-label={t(expanded ? 'nav.collapseTeam' : 'nav.expandTeam', {
                          team: team.displayName || team.name,
                        })}
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                          TOUCH_TARGET_SQUARE,
                        )}
                        onClick={() =>
                          setManuallyToggled(prev => ({ ...prev, [team.key]: !expanded }))
                        }
                        type="button"
                      >
                        <ChevronRight
                          className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')}
                        />
                      </button>
                      <Link
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-brand-subtle text-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                        href={href}
                        onClick={onNavigate}
                        title={team.displayName || team.name}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {team.icon ? (
                            <span className="text-xs">{team.icon}</span>
                          ) : (
                            <Users className={cn(isChild ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
                          )}
                        </span>
                        <span className={cn('truncate', isChild && 'text-xs')}>
                          {team.displayName || team.name}
                        </span>
                        {/* The team key is what people actually type in search
                            and read in identifiers, so it earns its place. */}
                        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {team.key}
                        </span>
                      </Link>
                    </div>
                    {expanded && (
                      <>
                        {/* Triage first, and only for teams that have it on.
                            The route existed with no link to it anywhere in the
                            app: a team could turn triage on in settings and
                            then have no way to reach the queue. */}
                        {team.triageEnabled && (
                          <TeamSubLink
                            active={isTriageActive}
                            href={triageHref}
                            icon={<Inbox className="h-3 w-3" />}
                            label={t('nav.triage')}
                            onNavigate={onNavigate}
                          />
                        )}
                        <TeamSubLink
                          active={isBacklogActive}
                          href={backlogHref}
                          icon={<Archive className="h-3 w-3" />}
                          label={t('nav.backlog')}
                          onNavigate={onNavigate}
                        />
                        <TeamSubLink
                          active={isCyclesActive}
                          href={cyclesHref}
                          icon={<RefreshCw className="h-3 w-3" />}
                          label={t('nav.cycles')}
                          onNavigate={onNavigate}
                        />
                        <TeamSubLink
                          active={isAnalyticsActive}
                          href={analyticsHref}
                          icon={<BarChart2 className="h-3 w-3" />}
                          label={t('nav.analytics')}
                          onNavigate={onNavigate}
                        />
                        <TeamSubLink
                          active={isDocsActive}
                          href={docsHref}
                          icon={<FileText className="h-3 w-3" />}
                          label={t('nav.docs')}
                          onNavigate={onNavigate}
                        />
                        {customViewStore.getByTeamId(team.id).map(view => (
                          <TeamSubLink
                            active={pathname === `${href}/view/${view.id}`}
                            href={`${href}/view/${view.id}`}
                            icon={<Eye className="h-3 w-3" />}
                            key={view.id}
                            label={view.name}
                            onNavigate={onNavigate}
                          />
                        ))}
                      </>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}

      {/* Collapsed: team icon strip */}
      {collapsed && teams.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 px-1.5">
          {teams.map(team => {
            const href = `${base}/team/${team.key}`;
            const isActive = pathname.startsWith(href);
            return (
              <li key={team.id}>
                <Link
                  className={cn(
                    'flex items-center justify-center rounded-md py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-brand-subtle text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  href={href}
                  onClick={onNavigate}
                  title={team.displayName || team.name}
                >
                  {team.icon ? (
                    <span className="text-xs">{team.icon}</span>
                  ) : (
                    <Users className="h-4 w-4" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
});

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed?: boolean;
  /** Whether the off-canvas mobile drawer is open (ignored at md+, which is always visible). */
  mobileOpen?: boolean;
  /** Close the mobile drawer (X button, backdrop click, or navigating). */
  onMobileClose?: () => void;
  onToggle?: () => void;
  workspaceKey?: string;
}

export const Sidebar = observer(function Sidebar({
  collapsed = false,
  onToggle,
  mobileOpen = false,
  onMobileClose,
  workspaceKey,
}: SidebarProps) {
  const { syncStore, uiStore } = useStore();
  const pathname = usePathname();
  const t = useTranslations();
  const appName = useAppName();
  const base = workspaceKey ? `/${workspaceKey}` : '';
  // The mobile drawer always shows full content — the desktop collapse
  // preference (a persistent-rail concept) doesn't apply to a transient overlay.
  const effectiveCollapsed = collapsed && !mobileOpen;

  const globalNavItems = [
    {
      href: `${base}/my-issues`,
      icon: <User className="h-4 w-4" />,
      label: t('nav.myIssues'),
    },
    {
      href: `${base}/inbox`,
      icon: <Inbox className="h-4 w-4" />,
      label: t('nav.inbox'),
    },
    {
      href: `${base}/projects`,
      icon: <Target className="h-4 w-4" />,
      label: t('nav.projects'),
    },
    // Initiatives shipped as a reachable-by-URL-only page: the route rendered
    // fine but nothing in the app linked to it, so the feature was invisible.
    {
      href: `${base}/initiatives`,
      icon: <Flag className="h-4 w-4" />,
      label: t('nav.initiatives'),
    },
    {
      href: `${base}/analytics`,
      icon: <BarChart2 className="h-4 w-4" />,
      label: t('nav.analytics'),
    },
  ];

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-shrink-0 flex-col border-r border-border bg-background transition-transform duration-200',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        'md:relative md:z-auto md:translate-x-0 md:transition-[width]',
        collapsed ? 'md:w-12' : 'md:w-60',
      )}
      data-collapsed={collapsed ? 'true' : 'false'}
      data-mobile-open={mobileOpen ? 'true' : 'false'}
    >
      {/* Workspace header */}
      <div className="flex h-12 items-center gap-2 border-b border-border px-2">
        <button
          aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:flex"
          onClick={onToggle}
          title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          type="button"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <WorkspaceSwitcher
          collapsed={effectiveCollapsed}
          fallbackLabel={syncStore.organizationName ?? workspaceKey ?? appName}
        />
        <button
          aria-label={t('nav.closeMenu')}
          className={cn(
            'ml-auto flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden',
            TOUCH_TARGET_SQUARE,
          )}
          onClick={onMobileClose}
          title={t('nav.closeMenu')}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {/* Search. The command palette was reachable only by ⌘K, which nobody
            discovers without being told; a search-shaped affordance is how
            every comparable product exposes it. Opens the same palette. */}
        <div className={cn('px-1.5 pb-2', effectiveCollapsed && 'px-1.5')}>
          <button
            aria-keyshortcuts="Meta+K Control+K"
            className={cn(
              'flex w-full items-center gap-2 rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              effectiveCollapsed && 'justify-center border-transparent bg-transparent px-0',
            )}
            onClick={() => uiStore.openCommandPalette()}
            title={t('common.search')}
            type="button"
          >
            <Search className="h-4 w-4 shrink-0" />
            {!effectiveCollapsed && (
              <>
                <span className="truncate">{t('nav.searchHint')}</span>
                <kbd className="ml-auto shrink-0 rounded border border-border px-1 font-sans text-[10px] text-muted-foreground">
                  ⌘K
                </kbd>
              </>
            )}
          </button>
        </div>

        {/* Global nav */}
        <ul className="flex flex-col gap-0.5 px-1.5">
          {globalNavItems.map(item => (
            <li key={item.href}>
              <Link
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  effectiveCollapsed && 'justify-center px-0',
                  pathname === item.href
                    ? 'bg-brand-subtle text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
                href={item.href}
                onClick={onMobileClose}
                title={item.label}
              >
                {item.icon}
                {!effectiveCollapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          ))}
        </ul>

        <SidebarFavoritesSection
          base={base}
          collapsed={effectiveCollapsed}
          onNavigate={onMobileClose}
          pathname={pathname}
        />
        <SidebarTeamsSection
          base={base}
          collapsed={effectiveCollapsed}
          onNavigate={onMobileClose}
          pathname={pathname}
        />
      </nav>

      {/* Footer */}
      <SidebarFooter
        base={base}
        collapsed={effectiveCollapsed}
        onNavigate={onMobileClose}
        pathname={pathname}
      />
    </aside>
  );
});

// ─── Footer ───────────────────────────────────────────────────────────────────

/**
 * One account menu, not a control dump.
 *
 * The footer used to render, inline in a 240px rail: a connection pill, a
 * Settings link, a cycling accent swatch, an EN|ES toggle, a three-way theme
 * toggle, the user's name and a Sign out button — across two rows that
 * collided, with the Settings label truncated to a single clipped letter. None
 * of those are navigation; they are preferences, and preferences belong behind
 * a menu. The rail now shows the viewer and nothing else.
 */
const SidebarFooter = observer(function SidebarFooter({
  base,
  collapsed,
  onNavigate,
  pathname,
}: {
  base: string;
  collapsed: boolean;
  onNavigate?: () => void;
  pathname: string;
}) {
  const { logout, user } = useAuth();
  const { uiStore, userStore } = useStore();
  const t = useTranslations();
  const settingsActive = pathname.startsWith(`${base}/settings`);
  // `useAuth().user` carries only id/email/displayName; the avatar fields live
  // on the synced user record, so the menu reads both.
  const profile = userStore.currentUser;

  const avatar = profile ? (
    <UserAvatar
      size="sm"
      user={{
        avatarBackgroundColor: profile.avatarBgColor,
        avatarUrl: profile.avatarUrl ?? null,
        displayName: profile.displayName,
        initials: profile.initials,
      }}
    />
  ) : (
    <User className="h-4 w-4" />
  );

  return (
    <div className="border-t border-border p-1.5">
      <SelectPopover
        align="left"
        className="w-full"
        panelClassName="bottom-full mb-1 left-0 w-56 p-1"
        triggerChildren={
          <>
            {avatar}
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-left text-sm text-foreground-secondary">
                  {user?.displayName ?? t('nav.userMenu')}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 -rotate-90 text-muted-foreground" />
              </>
            )}
          </>
        }
        triggerClassName={cn(
          'w-full gap-2 px-2 py-1.5',
          collapsed && 'justify-center px-0',
          TOUCH_TARGET,
        )}
        triggerTitle={user?.email ?? t('nav.userMenu')}
      >
        {close => (
          <>
            {user && (
              <div className="border-b border-border px-2 pb-2 pt-1">
                <p className="truncate text-sm font-medium text-foreground">{user.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            )}

            <Link
              className={cn(
                POPOVER_ITEM_CLASS,
                'rounded',
                settingsActive && 'bg-muted text-foreground',
              )}
              href={`${base}/settings`}
              onClick={() => {
                close();
                onNavigate?.();
              }}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {t('nav.workspaceSettings')}
            </Link>

            <button
              className={cn(POPOVER_ITEM_CLASS, 'rounded')}
              onClick={() => {
                close();
                uiStore.openShortcutHelp();
              }}
              type="button"
            >
              <Keyboard className="h-4 w-4 shrink-0" />
              {t('nav.keyboardShortcuts')}
              <kbd className="ml-auto rounded border border-border bg-surface-sunken px-1 font-mono text-[10px]">
                ?
              </kbd>
            </button>

            <div className="my-1 border-t border-border" />

            {/* Preference rows: label on the left, the existing toggle on the
                right. The toggles are unchanged — only their home moved. */}
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">{t('nav.appearance')}</span>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">{t('nav.accent')}</span>
              <AccentToggle />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">{t('nav.language')}</span>
              <LanguageToggle />
            </div>

            <div className="my-1 border-t border-border" />

            {/* Connection state stays in the menu rather than the rail: it is
                worth finding when something is wrong and worth nothing when it
                is fine, which is the definition of a menu row, not a fixture. */}
            <div className="px-2 py-1">
              <ConnectionStatus />
            </div>

            <div className="my-1 border-t border-border" />

            <button
              className={cn(POPOVER_ITEM_CLASS, 'rounded text-danger-subtle-foreground')}
              onClick={() => void logout()}
              type="button"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {t('common.signOut')}
            </button>
          </>
        )}
      </SelectPopover>
    </div>
  );
});
