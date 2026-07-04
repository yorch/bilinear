'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';
import { Sidebar } from './sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell = observer(function AppShell({ children }: AppShellProps) {
  const { uiStore } = useStore();
  const params = useParams<{ workspace?: string }>();
  const t = useTranslations();

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-indigo-600 focus:px-3 focus:py-1.5 focus:text-sm focus:text-white"
        href="#main-content"
      >
        {t('layout.skipToContent')}
      </a>
      <Sidebar
        collapsed={uiStore.sidebarCollapsed}
        onToggle={() => uiStore.toggleSidebarCollapsed()}
        workspaceKey={params.workspace}
      />
      <main className="flex flex-1 flex-col overflow-y-auto" id="main-content">
        {children}
      </main>
    </div>
  );
});
