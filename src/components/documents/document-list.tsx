'use client';

import { FileText, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';

interface DocumentListProps {
  teamId?: string;
  projectId?: string;
}

export const DocumentList = observer(function DocumentList({
  teamId,
  projectId,
}: DocumentListProps) {
  const { workspace } = useParams<{ workspace: string }>();
  const { documentStore } = useStore();

  const txQueue = useMemo(() => new TransactionQueue(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: MobX pool.size triggers re-computation when documents change
  const documents = useMemo(() => {
    if (teamId) {
      return documentStore.getByTeamId(teamId);
    }
    if (projectId) {
      return documentStore.getByProjectId(projectId);
    }
    return documentStore.all;
  }, [documentStore, teamId, projectId, documentStore.pool.size]);

  const handleNewDocument = () => {
    txQueue.enqueue(
      `mutation DocumentCreate($input: DocumentCreateInput!) {
        documentCreate(input: $input) {
          success
          lastSyncId
          document { id title }
        }
      }`,
      {
        input: {
          icon: null,
          projectId: projectId ?? null,
          teamId: teamId ?? null,
          title: 'Untitled',
        },
      },
      {},
    );
  };

  return (
    <div className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Documents
        </h2>
        <button
          type="button"
          onClick={handleNewDocument}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-3 w-3" />
          New Document
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-zinc-400">
          <FileText className="h-8 w-8" />
          <p className="text-sm">No documents yet</p>
          <button
            type="button"
            onClick={handleNewDocument}
            className="text-xs text-indigo-500 hover:text-indigo-600"
          >
            Create your first document
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {documents.map(doc => (
            <li key={doc.id}>
              <Link
                href={`/${workspace}/docs/${doc.id}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {doc.icon ? (
                    <span className="text-sm">{doc.icon}</span>
                  ) : (
                    <FileText className="h-4 w-4 text-zinc-400" />
                  )}
                </span>
                <span className="truncate">{doc.title || 'Untitled'}</span>
              </Link>
              {documentStore.getChildren(doc.id).map(child => (
                <Link
                  key={child.id}
                  href={`/${workspace}/docs/${child.id}`}
                  className="flex items-center gap-2 rounded-md py-1.5 pl-10 pr-3 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {child.icon ? (
                      <span className="text-xs">{child.icon}</span>
                    ) : (
                      <FileText className="h-3 w-3 text-zinc-400" />
                    )}
                  </span>
                  <span className="truncate">{child.title || 'Untitled'}</span>
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
