'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';

const NAV = [
  { href: '/admin', labelKey: 'admin.nav.dashboard' },
  { href: '/admin/tenants', labelKey: 'admin.nav.tenants' },
  { href: '/admin/users', labelKey: 'admin.nav.users' },
  { href: '/admin/audit', labelKey: 'admin.nav.audit' },
  { href: '/admin/config', labelKey: 'admin.nav.config' },
] as const;

const AdminEmailContext = createContext<string | null>(null);
const AdminIdContext = createContext<string | null>(null);

/** The signed-in platform admin's user id — compare by this, never by email. */
export function useAdminId(): string | null {
  return useContext(AdminIdContext);
}

/** The signed-in platform admin's email, so a page can guard actions on their own row. */
export function useAdminEmail(): string | null {
  return useContext(AdminEmailContext);
}

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
  adminId,
  children,
}: {
  adminEmail: string;
  adminId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const t = useTranslations();

  return (
    <AdminEmailContext.Provider value={adminEmail}>
      <AdminIdContext.Provider value={adminId}>
        <div className="min-h-full bg-background">
          <header className="border-b border-border bg-card">
            {/* Below md the five nav links cannot share a row with the title and
            the back link, so the nav drops to its own full-width row that
            scrolls sideways inside itself instead of widening the page. */}
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 md:h-14 md:flex-nowrap md:px-6">
              <div className="flex h-12 shrink-0 items-center gap-2 md:h-auto">
                <span className="rounded bg-primary px-1.5 py-0.5 font-bold text-primary-foreground text-xs uppercase tracking-wide">
                  {t('admin.nav.platformBadge')}
                </span>
                <span className="whitespace-nowrap font-semibold text-foreground text-sm">
                  {t('admin.nav.adminTitle')}
                </span>
              </div>
              <nav
                aria-label={t('admin.nav.adminTitle')}
                className="order-last -mx-1 flex w-full min-w-0 items-center gap-1 overflow-x-auto pb-1 md:order-none md:mx-0 md:w-auto md:pb-0"
              >
                {NAV.map(item => (
                  <Link
                    aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                    className={cn(
                      'flex shrink-0 items-center whitespace-nowrap rounded px-3 py-1.5 text-sm transition-colors max-md:min-h-11',
                      isActive(pathname, item.href)
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    href={item.href}
                    key={item.href}
                  >
                    {t(item.labelKey)}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <span className="hidden text-muted-foreground text-xs lg:inline">{adminEmail}</span>
                <Button asChild className={cn(TOUCH_TARGET)} size="sm" variant="outline">
                  <Link href="/">{t('admin.nav.backToApp')}</Link>
                </Button>
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</main>
        </div>
      </AdminIdContext.Provider>
    </AdminEmailContext.Provider>
  );
}
