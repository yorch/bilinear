'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { CycleDetailView } from '@/components/cycles/cycle-detail-view';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

const CycleDetailPage = observer(function CycleDetailPage() {
  const t = useTranslations();
  const {
    workspace,
    key: teamKey,
    cycleId,
  } = useParams<{
    workspace: string;
    key: string;
    cycleId: string;
  }>();
  const { teamStore, cycleStore, syncStore } = useStore();

  // The document title is owned by CycleDetailView, which also knows the
  // "Cycle N" fallback for an unnamed cycle.

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  if (isLoading) {
    return <PageSkeleton />;
  }

  const team = teamStore.findByKey(teamKey);
  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('cycles.teamNotFound')}
      </div>
    );
  }

  const cycle = cycleStore.findById(cycleId);
  if (!cycle || cycle.teamId !== team.id) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('cycles.cycleNotFound')}
      </div>
    );
  }

  return <CycleDetailView cycleId={cycleId} teamKey={teamKey} workspaceKey={workspace} />;
});

export default CycleDetailPage;
