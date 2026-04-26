'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { CycleListView } from '@/components/cycles/cycle-list-view';
import { useStore } from '@/providers/store-provider';

const TeamCyclesPage = observer(function TeamCyclesPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const { teamStore, syncStore } = useStore();

  const team = teamStore.findByKey(teamKey);

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading...
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        Failed to load data. Please refresh.
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Team not found.
      </div>
    );
  }

  return <CycleListView teamId={team.id} teamKey={teamKey} workspaceKey={workspace} />;
});

export default TeamCyclesPage;
