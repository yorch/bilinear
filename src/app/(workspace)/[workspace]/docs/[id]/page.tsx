'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { DocumentEditor } from '@/components/documents/document-editor';
import { DetailPanelSkeleton } from '@/components/ui/skeleton';
import { useStore } from '@/providers/store-provider';

const DocumentPage = observer(function DocumentPage() {
  const { id } = useParams<{ id: string; workspace: string }>();
  const { syncStore } = useStore();

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    return <DetailPanelSkeleton />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DocumentEditor documentId={id} />
    </div>
  );
});

export default DocumentPage;
