'use client';

import { Inbox, PanelLeft, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/my-issues',
    icon: <User className="h-4 w-4" />,
    label: 'My Issues',
  },
  { href: '/inbox', icon: <Inbox className="h-4 w-4" />, label: 'Inbox' },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
  workspaceKey?: string;
}

export function Sidebar({
  collapsed = false,
  onToggle,
  workspaceKey,
}: SidebarProps) {
  const pathname = usePathname();

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
            {workspaceKey ?? 'Issue Tracker'}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="flex flex-col gap-0.5 px-1.5">
          {NAV_ITEMS.map(item => (
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
      </nav>

      {/* Footer: theme toggle */}
      {!collapsed && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-2">
          <ThemeToggle />
        </div>
      )}
    </aside>
  );
}
