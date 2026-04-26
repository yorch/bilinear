'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useStore } from '@/providers/store-provider';
import { Sidebar } from './sidebar';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell = observer(function AppShell({ children }: AppShellProps) {
  const { uiStore } = useStore();
  const params = useParams<{ workspace?: string }>();

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-zinc-900">
      <Sidebar
        collapsed={uiStore.sidebarCollapsed}
        onToggle={() => uiStore.toggleSidebarCollapsed()}
        workspaceKey={params.workspace}
      />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
});
