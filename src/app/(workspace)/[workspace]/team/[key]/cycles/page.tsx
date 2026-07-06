'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { CycleListView } from '@/components/cycles/cycle-list-view';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

const TeamCyclesPage = observer(function TeamCyclesPage() {
  const t = useTranslations();
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
        {t('common.loading')}
      </div>
    );
  }

  if (hasError) {
    return <SyncErrorState message={t('cycles.failedToLoad')} />;
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {t('cycles.teamNotFound')}
      </div>
    );
  }

  return <CycleListView teamId={team.id} teamKey={teamKey} workspaceKey={workspace} />;
});

export default TeamCyclesPage;
