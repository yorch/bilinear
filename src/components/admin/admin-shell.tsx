'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/admin', labelKey: 'admin.nav.dashboard' },
  { href: '/admin/tenants', labelKey: 'admin.nav.tenants' },
  { href: '/admin/users', labelKey: 'admin.nav.users' },
  { href: '/admin/audit', labelKey: 'admin.nav.audit' },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/admin') {
    return pathname === '/admin';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Chrome for the platform console: a top bar with cross-tenant navigation and
 * a link back to the workspace app. Rendered by the (admin) layout only after
 * the server-side platform-admin check passes.
 */
export function AdminShell({
  adminEmail,
  children,
}: {
  adminEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <div className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-6">
          <div className="flex items-center gap-2">
            <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {t('admin.nav.platformBadge')}
            </span>
            <span className="text-sm font-semibold text-foreground">
              {t('admin.nav.adminTitle')}
            </span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map(item => (
              <Link
                className={cn(
                  'rounded px-3 py-1.5 text-sm transition-colors',
                  isActive(pathname, item.href)
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
                href={item.href}
                key={item.href}
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-zinc-400 sm:inline">{adminEmail}</span>
            <Link
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              href="/"
            >
              {t('admin.nav.backToApp')}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
