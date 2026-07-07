'use client';

import {
  Archive,
  BarChart2,
  BookOpen,
  Eye,
  FileText,
  Flag,
  Inbox,
  Layers,
  LogOut,
  PanelLeft,
  Plus,
  RefreshCw,
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
import { useEffect, useMemo, useState } from 'react';
import { LanguageToggle } from '@/components/language-toggle';
import { ConnectionStatus } from '@/components/layouts/connection-status';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from '@/hooks/use-translations';
import { APP_NAME } from '@/lib/app-config';
import { gql } from '@/lib/graphql';
import { FAVORITE_DELETE_MUTATION, FAVORITES_QUERY } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
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
    | { __typename: 'CustomView'; id: string; name: string; teamId: string }
    | { __typename: 'Cycle'; id: string; name: string; teamId: string }
    | { __typename: 'Document'; id: string; title: string; teamId: string }
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

function favoriteLabel(fav: FavoriteMeta): string {
  const e = fav.entity;
  if (!e) {
    return '';
  }
  switch (e.__typename) {
    case 'Issue':
      return `${e.identifier} ${e.title}`;
    case 'Document':
      return e.title;
    default:
      return e.name;
  }
}

function favoriteHref(
  fav: FavoriteMeta,
  base: string,
  findTeamById: (id: string) => { key: string } | null | undefined,
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
    case 'CustomView': {
      const key = findTeamById(e.teamId)?.key;
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
  const [favorites, setFavorites] = useState<FavoriteMeta[]>([]);

  // Derive a stable string from the MobX store that changes on any insert,
  // delete, or sortOrder update so the sidebar re-fetches full entity data.
  const favStoreKey = favoriteStore.all.map(f => `${f.id}:${f.sortOrder}`).join(',');

  // biome-ignore lint/correctness/useExhaustiveDependencies: favStoreKey is a MobX-derived reactive trigger, not used inside the callback
  useEffect(() => {
    gql(FAVORITES_QUERY, {})
      .then(res => {
        const data = res.data as { favorites?: FavoriteMeta[] } | undefined;
        const list = data?.favorites ?? [];
        setFavorites(list.filter(f => f.entity !== null).sort((a, b) => a.sortOrder - b.sortOrder));
      })
      .catch(() => {});
  }, [favStoreKey]);

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

  if (collapsed || favorites.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 px-1.5">
      <div className="mb-1 flex items-center px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('nav.favorites')}
        </span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {favorites.map(fav => {
          const href = favoriteHref(fav, base, id => teamStore.findById(id));
          const label = favoriteLabel(fav);
          const isActive = pathname === href;
          return (
            <li className="group flex items-center" key={fav.id}>
              <Link
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
                className="mr-1 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:text-zinc-700 group-hover:flex dark:hover:text-zinc-200"
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
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-zinc-700 dark:hover:text-zinc-300"
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
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-zinc-700 dark:hover:text-zinc-300"
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
                const viewHrefPrefix = `${href}/view/`;
                const analyticsHref = `${href}/analytics`;
                const isActive =
                  pathname === href ||
                  (pathname.startsWith(`${href}/`) &&
                    !pathname.startsWith(cyclesHref) &&
                    !pathname.startsWith(backlogHref) &&
                    !pathname.startsWith(docsHref) &&
                    !pathname.startsWith(analyticsHref) &&
                    !pathname.startsWith(viewHrefPrefix));
                const isCyclesActive = pathname.startsWith(cyclesHref);
                const isBacklogActive = pathname.startsWith(backlogHref);
                const isDocsActive = pathname.startsWith(docsHref);
                const isAnalyticsActive = pathname.startsWith(analyticsHref);
                return (
                  <li className={cn('flex flex-col gap-0.5', isChild && 'ml-3')} key={team.id}>
                    <Link
                      className={cn(
                        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
                    </Link>
                    <Link
                      className={cn(
                        'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                        isBacklogActive
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      href={backlogHref}
                      onClick={onNavigate}
                      title={t('nav.backlog')}
                    >
                      <Archive className="h-3 w-3" />
                      {t('nav.backlog')}
                    </Link>
                    <Link
                      className={cn(
                        'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                        isCyclesActive
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      href={cyclesHref}
                      onClick={onNavigate}
                      title={t('nav.cycles')}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t('nav.cycles')}
                    </Link>
                    <Link
                      className={cn(
                        'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                        isAnalyticsActive
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      href={analyticsHref}
                      onClick={onNavigate}
                      title={t('nav.analytics')}
                    >
                      <BarChart2 className="h-3 w-3" />
                      {t('nav.analytics')}
                    </Link>
                    <Link
                      className={cn(
                        'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                        isDocsActive
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      href={docsHref}
                      onClick={onNavigate}
                      title={t('nav.docs')}
                    >
                      <FileText className="h-3 w-3" />
                      {t('nav.docs')}
                    </Link>
                    {customViewStore.getByTeamId(team.id).map(view => {
                      const viewHref = `${href}/view/${view.id}`;
                      const isViewActive = pathname === viewHref;
                      return (
                        <Link
                          className={cn(
                            'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                            isViewActive
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                          href={viewHref}
                          key={view.id}
                          onClick={onNavigate}
                          title={view.name}
                        >
                          <Eye className="h-3 w-3" />
                          <span className="truncate">{view.name}</span>
                        </Link>
                      );
                    })}
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
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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
  const { syncStore } = useStore();
  const pathname = usePathname();
  const t = useTranslations();
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
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:flex"
          onClick={onToggle}
          title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          type="button"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        {!effectiveCollapsed && (
          <span className="truncate text-sm font-semibold text-foreground">
            {syncStore.organizationName ?? workspaceKey ?? APP_NAME}
          </span>
        )}
        <button
          aria-label={t('nav.closeMenu')}
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          onClick={onMobileClose}
          title={t('nav.closeMenu')}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {/* Global nav */}
        <ul className="flex flex-col gap-0.5 px-1.5">
          {globalNavItems.map(item => (
            <li key={item.href}>
              <Link
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  effectiveCollapsed && 'justify-center px-0',
                  pathname === item.href
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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

function SidebarFooter({
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
  const t = useTranslations();
  return (
    <div className="border-t border-border p-1.5">
      {collapsed ? (
        <div className="flex flex-col items-center gap-1">
          <ConnectionStatus compact />
          <Link
            className={cn(
              'flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              pathname.startsWith(`${base}/settings`) && 'bg-muted text-foreground',
            )}
            href={`${base}/settings`}
            onClick={onNavigate}
            title={t('common.settings')}
          >
            <Settings className="h-4 w-4" />
          </Link>
          <ThemeToggle compact />
          <LanguageToggle compact />
          <button
            aria-label={t('common.signOut')}
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => void logout()}
            title={t('common.signOut')}
            type="button"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <ConnectionStatus />
          <div className="flex items-center justify-between gap-1">
            <Link
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                pathname.startsWith(`${base}/settings`) && 'bg-muted text-foreground',
              )}
              href={`${base}/settings`}
              onClick={onNavigate}
              title={t('nav.workspaceSettings')}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span className="truncate">{t('common.settings')}</span>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
          {user && (
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate" title={user.email}>
                {user.displayName}
              </span>
              <button
                aria-label={t('common.signOut')}
                className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => void logout()}
                title={t('common.signOut')}
                type="button"
              >
                <LogOut className="h-3 w-3" />
                <span className="truncate">{t('common.signOut')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
