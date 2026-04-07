'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { lazy, Suspense } from 'react';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useRecentItems } from '@/hooks/use-recent-items';
import { useStore } from '@/providers/store-provider';

const CommandPalette = lazy(() =>
  import('@/components/command-palette/command-palette').then(m => ({
    default: m.CommandPalette,
  })),
);

/**
 * Client-only wrapper for the workspace layout.
 * Registers global shortcuts (Cmd+K command palette, Cmd+B sidebar toggle)
 * and renders the lazy-loaded CommandPalette.
 * Must be inside StoreProvider and SyncProvider to access stores.
 */
export const WorkspaceClient = observer(function WorkspaceClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const { uiStore } = useStore();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace;
  const { items: recentItems } = useRecentItems(workspaceKey);

  // Cmd+K / Ctrl+K — open command palette (fires even from inputs)
  useHotkeys(
    'meta+k',
    () => uiStore.toggleCommandPalette(),
    { allowInInput: true },
    [uiStore],
  );
  useHotkeys(
    'ctrl+k',
    () => uiStore.toggleCommandPalette(),
    { allowInInput: true },
    [uiStore],
  );

  // Cmd+B / Ctrl+B — toggle sidebar
  useHotkeys(
    'meta+b',
    () => uiStore.toggleSidebarCollapsed(),
    { allowInInput: false },
    [uiStore],
  );
  useHotkeys(
    'ctrl+b',
    () => uiStore.toggleSidebarCollapsed(),
    { allowInInput: false },
    [uiStore],
  );

  return (
    <>
      {children}
      {uiStore.commandPaletteOpen && (
        <Suspense>
          <CommandPalette recentItems={recentItems} />
        </Suspense>
      )}
    </>
  );
});
