'use client';

import {
  Archive,
  BarChart2,
  Eye,
  FileText,
  Inbox,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings,
  Target,
  User,
  Users,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  workspaceKey?: string;
}

export const Sidebar = observer(function Sidebar({
  collapsed = false,
  onToggle,
  workspaceKey,
}: SidebarProps) {
  const { customViewStore, teamStore, uiStore, syncStore } = useStore();
  const pathname = usePathname();
  const base = workspaceKey ? `/${workspaceKey}` : '';

  const globalNavItems = [
    {
      href: `${base}/my-issues`,
      icon: <User className="h-4 w-4" />,
      label: 'My Issues',
    },
    {
      href: `${base}/inbox`,
      icon: <Inbox className="h-4 w-4" />,
      label: 'Inbox',
    },
    {
      href: `${base}/projects`,
      icon: <Target className="h-4 w-4" />,
      label: 'Projects',
    },
  ];

  const allTeams = teamStore.all;
  // Build hierarchy: root teams (no parent) with their children
  const rootTeams = allTeams.filter(t => !t.parentId);
  const childTeamsByParent = allTeams.reduce<Record<string, typeof allTeams>>(
    (acc, t) => {
      if (t.parentId) {
        if (!acc[t.parentId]) {
          acc[t.parentId] = [];
        }
        acc[t.parentId].push(t);
      }
      return acc;
    },
    {},
  );
  // Flatten into display order: each root team followed by its children
  const teams = rootTeams.flatMap(t => [
    t,
    ...(childTeamsByParent[t.id] ?? []),
  ]);

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex h-full flex-shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-[width] duration-200 dark:border-zinc-800 dark:bg-zinc-950',
        collapsed ? 'w-12' : 'w-56',
      )}
    >
      {/* Workspace header */}
      <div className="flex h-12 items-center border-b border-zinc-200 dark:border-zinc-800 px-2 gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar (⌘B)' : 'Collapse sidebar (⌘B)'}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        {!collapsed && (
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {syncStore.organizationName ?? workspaceKey ?? 'Issue Tracker'}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {/* Global nav */}
        <ul className="flex flex-col gap-0.5 px-1.5">
          {globalNavItems.map(item => (
            <li key={item.href}>
              <Link
                href={item.href}
                title={item.label}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  collapsed && 'justify-center px-0',
                  pathname === item.href
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                )}
              >
                {item.icon}
                {!collapsed && item.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Teams section */}
        {!collapsed && (
          <div className="mt-4 px-1.5">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Teams
              </span>
              <button
                type="button"
                onClick={() => uiStore.openCreateTeamModal()}
                title="New team"
                aria-label="New team"
                className="flex h-5 w-5 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <ul className="flex flex-col gap-0.5">
              {teams.length === 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={() => uiStore.openCreateTeamModal()}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Create a team
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
                    <li
                      key={team.id}
                      className={cn('flex flex-col gap-0.5', isChild && 'ml-3')}
                    >
                      <Link
                        href={href}
                        title={team.displayName || team.name}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                          isActive
                            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                        )}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {team.icon ? (
                            <span className="text-xs">{team.icon}</span>
                          ) : (
                            <Users
                              className={cn(
                                isChild ? 'h-3 w-3' : 'h-3.5 w-3.5',
                              )}
                            />
                          )}
                        </span>
                        <span className={cn('truncate', isChild && 'text-xs')}>
                          {team.displayName || team.name}
                        </span>
                      </Link>
                      <Link
                        href={backlogHref}
                        title="Backlog"
                        className={cn(
                          'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                          isBacklogActive
                            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                        )}
                      >
                        <Archive className="h-3 w-3" />
                        Backlog
                      </Link>
                      <Link
                        href={cyclesHref}
                        title="Cycles"
                        className={cn(
                          'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                          isCyclesActive
                            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                        )}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Cycles
                      </Link>
                      <Link
                        href={analyticsHref}
                        title="Analytics"
                        className={cn(
                          'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                          isAnalyticsActive
                            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                        )}
                      >
                        <BarChart2 className="h-3 w-3" />
                        Analytics
                      </Link>
                      <Link
                        href={docsHref}
                        title="Docs"
                        className={cn(
                          'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                          isDocsActive
                            ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                        )}
                      >
                        <FileText className="h-3 w-3" />
                        Docs
                      </Link>
                      {/* Custom Views for this team */}
                      {customViewStore.getByTeamId(team.id).map(view => {
                        const viewHref = `${href}/view/${view.id}`;
                        const isViewActive = pathname === viewHref;
                        return (
                          <Link
                            key={view.id}
                            href={viewHref}
                            title={view.name}
                            className={cn(
                              'flex items-center gap-2 rounded-md py-1 pl-8 pr-2 text-xs transition-colors',
                              isViewActive
                                ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                            )}
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

        {/* Collapsed: team icons */}
        {collapsed && teams.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 px-1.5">
            {teams.map(team => {
              const href = `${base}/team/${team.key}`;
              const isActive = pathname.startsWith(href);
              return (
                <li key={team.id}>
                  <Link
                    href={href}
                    title={team.displayName || team.name}
                    className={cn(
                      'flex items-center justify-center rounded-md py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                    )}
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
      </nav>

      {/* Footer */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 p-1.5">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Link
              href={`${base}/settings`}
              title="Settings"
              className={cn(
                'flex items-center justify-center rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                pathname.startsWith(`${base}/settings`) &&
                  'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50',
              )}
            >
              <Settings className="h-4 w-4" />
            </Link>
            <ThemeToggle compact />
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <Link
              href={`${base}/settings`}
              title="Workspace settings"
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                pathname.startsWith(`${base}/settings`) &&
                  'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50',
              )}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
            <ThemeToggle />
          </div>
        )}
      </div>
    </aside>
  );
});
