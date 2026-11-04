'use client';

import { observer } from 'mobx-react-lite';
import { DocumentList } from '@/components/documents/document-list';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { useStore } from '@/providers/store-provider';

/**
 * Workspace-wide document index. Documents with no team (project docs) have no
 * team docs list to go back to; this is where they, and the back arrow of a
 * team-less document, land.
 */
const WorkspaceDocsPage = observer(function WorkspaceDocsPage() {
  const { syncStore } = useStore();
  const t = useTranslations();
  useDocumentTitle(t('nav.docs'));

  if (syncStore.status === 'bootstrapping' || syncStore.status === 'idle') {
    return <PageSkeleton />;
  }
  if (syncStore.status === 'error') {
    return <SyncErrorState message={t('documents.loadFailed')} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title={t('nav.docs')} />
      <div className="flex-1 overflow-y-auto">
        <DocumentList />
      </div>
    </div>
  );
});

export default WorkspaceDocsPage;
