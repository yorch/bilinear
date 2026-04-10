'use client';

import {
  Inbox,
  PanelLeft,
  Plus,
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
  const { teamStore, uiStore, syncStore } = useStore();
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

  const teams = teamStore.all;

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
                  const href = `${base}/team/${team.key}`;
                  const isActive =
                    pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <li key={team.id}>
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
                            <Users className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="truncate">
                          {team.displayName || team.name}
                        </span>
                      </Link>
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
