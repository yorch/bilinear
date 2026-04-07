'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { lazy, Suspense, useCallback } from 'react';
import { CreateTeamModal } from '@/components/teams/create-team-modal';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useRecentItems } from '@/hooks/use-recent-items';
import { gql } from '@/lib/graphql';
import { useStore } from '@/providers/store-provider';
import { gqlError } from '@/lib/utils';
import type { DBTeam } from '@/lib/db';

const CommandPalette = lazy(() =>
  import('@/components/command-palette/command-palette').then(m => ({
    default: m.CommandPalette,
  })),
);

const TEAM_CREATE_MUTATION = `
  mutation TeamCreate($input: TeamCreateInput!) {
    teamCreate(input: $input) {
      success
      lastSyncId
      team {
        id organizationId parentId
        key name displayName description icon color private timezone
        cyclesEnabled issueEstimationType triageEnabled issueCount
        createdAt updatedAt archivedAt
      }
    }
  }
`;

/**
 * Client-only wrapper for the workspace layout.
 * Registers global shortcuts (Cmd+K command palette, Cmd+B sidebar toggle)
 * and renders the lazy-loaded CommandPalette and CreateTeamModal.
 * Must be inside StoreProvider and SyncProvider to access stores.
 */
export const WorkspaceClient = observer(function WorkspaceClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const { uiStore, teamStore } = useStore();
  const params = useParams<{ workspace?: string }>();
  const workspaceKey = params.workspace;
  const { items: recentItems } = useRecentItems(workspaceKey);
  const router = useRouter();

  useHotkeys(
    ['meta+k', 'ctrl+k'],
    () => uiStore.toggleCommandPalette(),
    { allowInInput: true },
    [uiStore],
  );
  useHotkeys(['meta+b', 'ctrl+b'], () => uiStore.toggleSidebarCollapsed(), {}, [
    uiStore,
  ]);

  const handleCreateTeam = useCallback(
    async (input: {
      name: string;
      key: string;
      description?: string;
      private: boolean;
    }) => {
      const result = await gql(TEAM_CREATE_MUTATION, { input });
      if (result.errors?.length) {
        throw new Error(gqlError(result, 'Failed to create team'));
      }
      const team = (result.data?.teamCreate as { team?: DBTeam })?.team;
      if (team) {
        teamStore.applySyncAction('I', team.id, team);
        if (workspaceKey) {
          router.push(`/${workspaceKey}/team/${team.key}`);
        }
      }
    },
    [teamStore, workspaceKey, router],
  );

  return (
    <>
      {children}
      {uiStore.commandPaletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette recentItems={recentItems} />
        </Suspense>
      )}
      <CreateTeamModal
        open={uiStore.createTeamModalOpen}
        onClose={() => uiStore.closeCreateTeamModal()}
        onSubmit={handleCreateTeam}
      />
    </>
  );
});
