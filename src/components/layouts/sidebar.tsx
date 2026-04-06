'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/my-issues', label: 'My Issues' },
  { href: '/inbox', label: 'Inbox' },
];

interface SidebarProps {
  workspaceKey?: string;
}

export function Sidebar({ workspaceKey }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-56 flex-shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Workspace header */}
      <div className="flex h-12 items-center px-3 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
          {workspaceKey ?? 'Issue Tracker'}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="flex flex-col gap-0.5 px-1.5">
          {NAV_ITEMS.map(item => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                  pathname === item.href
                    ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
