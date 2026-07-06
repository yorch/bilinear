'use client';

import { observer } from 'mobx-react-lite';
import { useParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';
import { MobileTopBar } from './mobile-top-bar';
import { Sidebar } from './sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell = observer(function AppShell({ children }: AppShellProps) {
  const { uiStore } = useStore();
  const params = useParams<{ workspace?: string }>();
  const pathname = usePathname();
  const t = useTranslations();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the off-canvas drawer whenever the route changes (a Link click
  // inside it, browser back/forward, etc.) so it never sits open covering
  // the page the user just navigated to.
  useEffect(() => {
    void pathname; // must be referenced here; Biome strips unused effect deps
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-indigo-600 focus:px-3 focus:py-1.5 focus:text-sm focus:text-white"
        href="#main-content"
      >
        {t('layout.skipToContent')}
      </a>
      {mobileNavOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <Sidebar
        collapsed={uiStore.sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        onToggle={() => uiStore.toggleSidebarCollapsed()}
        workspaceKey={params.workspace}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MobileTopBar onOpenNav={() => setMobileNavOpen(true)} workspaceKey={params.workspace} />
        <main className="flex flex-1 flex-col overflow-y-auto" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
});
