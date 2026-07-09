'use client';

import { FileText, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { createDocument } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { useStore } from '@/providers/store-provider';

interface DocumentListProps {
  projectId?: string;
  teamId?: string;
}

export const DocumentList = observer(function DocumentList({
  teamId,
  projectId,
}: DocumentListProps) {
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  const { documentStore } = useStore();
  const t = useTranslations();
  const [creating, setCreating] = useState(false);

  // Plain selector — observer() picks up the observable reads, so the
  // selector re-runs on any mutation (rename, archive). Memoizing on
  // `pool.size` skipped in-place updates.
  const documents = teamId
    ? documentStore.getByTeamId(teamId)
    : projectId
      ? documentStore.getByProjectId(projectId)
      : documentStore.all;

  const handleNewDocument = async () => {
    setCreating(true);
    try {
      const result = await createDocument({
        projectId: projectId ?? undefined,
        teamId: teamId ?? undefined,
        title: t('documents.untitled'),
      });
      const id = (result.data as { documentCreate?: { document?: { id: string } } })?.documentCreate
        ?.document?.id;
      if (id) {
        router.push(`/${workspace}/docs/${id}`);
      }
    } catch {
      toast.error(t('documents.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground">{t('documents.title')}</h2>
        <button
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          disabled={creating}
          onClick={handleNewDocument}
          type="button"
        >
          <Plus className="h-3 w-3" />
          {creating ? t('documents.creating') : t('documents.newDocument')}
        </button>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
          <FileText className="h-8 w-8" />
          <p className="text-sm">{t('documents.emptyState')}</p>
          <button
            className="text-xs text-brand hover:text-brand-hover disabled:opacity-50"
            disabled={creating}
            onClick={handleNewDocument}
            type="button"
          >
            {creating ? t('documents.creating') : t('documents.createFirst')}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {documents.map(doc => (
            <li key={doc.id}>
              <Link
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground-secondary hover:bg-muted"
                href={`/${workspace}/docs/${doc.id}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {doc.icon ? (
                    <span className="text-sm">{doc.icon}</span>
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  )}
                </span>
                <span className="truncate">{doc.title || t('documents.untitled')}</span>
              </Link>
              {documentStore.getChildren(doc.id).map(child => (
                <Link
                  className="flex items-center gap-2 rounded-md py-1.5 pl-10 pr-3 text-xs text-muted-foreground hover:bg-muted"
                  href={`/${workspace}/docs/${child.id}`}
                  key={child.id}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {child.icon ? (
                      <span className="text-xs">{child.icon}</span>
                    ) : (
                      <FileText className="h-3 w-3 text-muted-foreground" />
                    )}
                  </span>
                  <span className="truncate">{child.title || t('documents.untitled')}</span>
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
