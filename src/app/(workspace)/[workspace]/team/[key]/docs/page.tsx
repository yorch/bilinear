'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { DocumentList } from '@/components/documents/document-list';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

const TeamDocsPage = observer(function TeamDocsPage() {
  const { key: teamKey } = useParams<{ key: string; workspace: string }>();
  const { teamStore, syncStore } = useStore();
  const t = useTranslations();

  const team = teamStore.findByKey(teamKey);

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (hasError) {
    return <SyncErrorState message={t('documents.loadFailed')} />;
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('documents.teamNotFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        title={t('documents.teamDocsTitle', { teamName: team.displayName ?? team.name })}
      />
      <div className="flex-1 overflow-y-auto">
        <DocumentList teamId={team.id} />
      </div>
    </div>
  );
});

export default TeamDocsPage;
