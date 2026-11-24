'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { InitiativeDetail } from '@/components/initiatives/initiative-detail';
import { DetailPanelSkeleton } from '@/components/ui/skeleton';
import { useStore } from '@/providers/store-provider';

const InitiativePage = observer(function InitiativePage() {
  const { id, workspace } = useParams<{ id: string; workspace: string }>();
  const { syncStore } = useStore();

  if (syncStore.status === 'bootstrapping' || syncStore.status === 'idle') {
    return <DetailPanelSkeleton />;
  }
  return <InitiativeDetail initiativeId={id} workspace={workspace} />;
});

export default InitiativePage;
