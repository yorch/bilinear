'use client';

import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { DocumentList, useCreateDocument } from '@/components/documents/document-list';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

const TeamDocsPage = observer(function TeamDocsPage() {
  const { key: teamKey } = useParams<{ key: string; workspace: string }>();
  const { teamStore, syncStore } = useStore();
  const t = useTranslations();
  useDocumentTitle(t('nav.docs'));

  const team = teamStore.findByKey(teamKey);
  // Hooks cannot sit after the loading/error early-returns below.
  const { create, creating } = useCreateDocument({ teamId: team?.id });

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
        actions={
          <Button disabled={creating} onClick={() => void create()} size="sm">
            <Plus className="h-3.5 w-3.5" />
            {creating ? t('documents.creating') : t('documents.newDocument')}
          </Button>
        }
        title={t('documents.teamDocsTitle', { teamName: team.displayName ?? team.name })}
      />
      <div className="flex-1 overflow-y-auto">
        <DocumentList teamId={team.id} />
      </div>
    </div>
  );
});

export default TeamDocsPage;
