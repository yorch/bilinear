'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { DocumentList } from '@/components/documents/document-list';
import { useStore } from '@/providers/store-provider';

const TeamDocsPage = observer(function TeamDocsPage() {
  const { key: teamKey } = useParams<{ key: string; workspace: string }>();
  const { teamStore, syncStore } = useStore();

  const team = teamStore.findByKey(teamKey);

  const isLoading =
    syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {team.displayName ?? team.name} — Docs
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        <DocumentList teamId={team.id} />
      </div>
    </div>
  );
});

export default TeamDocsPage;
