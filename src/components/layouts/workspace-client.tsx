'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { CommandPalette } from '@/components/command-palette/command-palette';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useRecentItems } from '@/hooks/use-recent-items';
import { useStore } from '@/providers/store-provider';

/**
 * Client-only wrapper for the workspace layout.
 * Registers the global Cmd+K / Ctrl+K shortcut and renders the CommandPalette.
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

  // Cmd+K / Ctrl+K — open command palette from anywhere (including inputs)
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

  return (
    <>
      {children}
      <CommandPalette recentItems={recentItems} />
    </>
  );
});
