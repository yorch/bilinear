'use client';

import { observer } from 'mobx-react-lite';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
  // Stable identity: the Sidebar's drawer effect depends on it, and a fresh
  // function per render re-ran that effect (stealing focus) on every re-render.
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Close the off-canvas drawer whenever the route changes (a Link click
  // inside it, browser back/forward, etc.) so it never sits open covering
  // the page the user just navigated to.
  useEffect(() => {
    void pathname; // must be referenced here; Biome strips unused effect deps
    setMobileNavOpen(false);
  }, [pathname]);

  // The palette opened from the drawer's Search button would otherwise sit
  // over a still-open drawer.
  const paletteOpen = uiStore.commandPaletteOpen;
  useEffect(() => {
    if (paletteOpen) {
      setMobileNavOpen(false);
    }
  }, [paletteOpen]);

  // The drawer only exists below `md`. If the viewport grows past it while the
  // drawer is open (rotation, window resize) the page content must not stay
  // inert behind a drawer that is now the permanent rail.
  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) {
        setMobileNavOpen(false);
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mobileNavOpen]);

  return (
    <div className="flex h-screen overflow-hidden bg-card">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground"
        href="#main-content"
        inert={mobileNavOpen}
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
        onMobileClose={closeMobileNav}
        onToggle={() => uiStore.toggleSidebarCollapsed()}
        workspaceKey={params.workspace}
      />
      {/* `inert` while the drawer is open: it is the focus trap (Tab cannot
          reach the page behind the backdrop) and hides the page from AT. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden" inert={mobileNavOpen}>
        <MobileTopBar onOpenNav={() => setMobileNavOpen(true)} workspaceKey={params.workspace} />
        <main className="flex flex-1 flex-col overflow-y-auto" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
});
