'use client';

import { Archive, ArrowLeft, ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MentionItem } from '@/components/editor/mention-list';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn, getErrorMessage, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Shared by the debounced content save and the debounced title save below —
 * one operation, one selection set. Kept verbatim from the two copies it
 * replaces so the enqueued TransactionQueue payload is unchanged.
 */
const DOCUMENT_UPDATE_MUTATION = `mutation DocumentUpdate($id: ID!, $input: DocumentUpdateInput!) {
  documentUpdate(id: $id, input: $input) {
    success
    lastSyncId
    document { id title content updatedAt }
  }
}`;

const DOCUMENT_ARCHIVE_MUTATION = `mutation ($id: ID!) { documentArchive(id: $id) { success } }`;
const DOCUMENT_DELETE_MUTATION = `mutation ($id: ID!) { documentDelete(id: $id) { success } }`;

interface DocumentEditorProps {
  documentId: string;
}

export const DocumentEditor = observer(function DocumentEditor({
  documentId,
}: DocumentEditorProps) {
  const { documentStore, teamStore, userStore } = useStore();
  const t = useTranslations();
  const router = useRouter();
  const { workspace } = useParams<{ workspace: string }>();
  const txQueue = useMemo(() => new TransactionQueue(), []);
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete' | null>(null);

  const mentionUsers: MentionItem[] = userStore.all.map(u => ({ id: u.id, label: u.displayName }));

  const currentUserName = userStore.currentUser?.displayName ?? t('documents.defaultUserName');

  const doc = documentStore.findById(documentId);

  // Controlled local title — initialised from store, updated on remote sync via key reset
  const [localTitle, setLocalTitle] = useState(doc?.title ?? '');

  // Sync title from store when a remote update arrives (different doc or external edit)
  useEffect(() => {
    if (doc?.title !== undefined) {
      setLocalTitle(doc.title);
    }
  }, [doc?.title]);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (html: string) => {
      if (!doc) {
        return;
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        txQueue.enqueue(DOCUMENT_UPDATE_MUTATION, { id: documentId, input: { content: html } }, {});
      }, 1000);
    },
    [doc, documentId, txQueue],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const title = e.target.value;
      setLocalTitle(title);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        txQueue.enqueue(DOCUMENT_UPDATE_MUTATION, { id: documentId, input: { title } }, {});
      }, 1000);
    },
    [documentId, txQueue],
  );

  useEffect(
    () => () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    },
    [],
  );

  if (!doc) {
    return <EmptyState className="flex-1" title={t('documents.documentNotFound')} />;
  }

  // Where "back" goes: the owning team's docs list when there is one, else the
  // workspace root. Both archive and delete land here too — the store drops the
  // row either way and staying would render "not found" over it.
  const team = doc.teamId ? teamStore.findById(doc.teamId) : null;
  const docsHref = team ? `/${workspace}/team/${team.key}/docs` : `/${workspace}`;

  const runAction = async (action: 'archive' | 'delete') => {
    try {
      await gqlMutate(action === 'archive' ? DOCUMENT_ARCHIVE_MUTATION : DOCUMENT_DELETE_MUTATION, {
        id: documentId,
      });
      toast.success(
        action === 'archive' ? t('documents.documentArchived') : t('documents.documentDeleted'),
      );
      router.push(docsHref);
    } catch (err) {
      toast.error(
        getErrorMessage(
          err,
          action === 'archive' ? t('documents.archiveFailed') : t('documents.deleteFailed'),
        ),
      );
    }
  };

  const crumbClass = 'truncate text-xs text-muted-foreground hover:text-foreground';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        actions={
          <SelectPopover
            align="right"
            panelClassName="min-w-[160px] py-1"
            triggerChildren={<MoreHorizontal className="h-4 w-4" />}
            triggerClassName={cn(
              'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
              TOUCH_TARGET_SQUARE,
            )}
            triggerTitle={t('documents.moreActions')}
          >
            {close => (
              <>
                <button
                  className={cn(POPOVER_ITEM_CLASS, 'text-foreground-secondary')}
                  onClick={() => {
                    close();
                    setPendingAction('archive');
                  }}
                  type="button"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t('documents.archive')}
                </button>
                <button
                  className={cn(POPOVER_ITEM_CLASS, 'text-danger-subtle-foreground')}
                  onClick={() => {
                    close();
                    setPendingAction('delete');
                  }}
                  type="button"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('common.delete')}
                </button>
              </>
            )}
          </SelectPopover>
        }
        leading={
          <Link
            aria-label={t('documents.backToDocs')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
              TOUCH_TARGET_SQUARE,
            )}
            href={docsHref}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        title={
          <span className="flex min-w-0 items-center gap-1">
            {team && (
              <>
                <Link className={crumbClass} href={`/${workspace}/team/${team.key}`}>
                  {team.name}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              </>
            )}
            <Link className={crumbClass} href={docsHref}>
              {t('documents.title')}
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{localTitle || t('documents.untitled')}</span>
          </span>
        }
      />
      <div className="border-b border-border px-8 py-4">
        <input
          className="w-full bg-transparent text-2xl font-bold text-foreground placeholder-muted-foreground outline-none"
          onChange={handleTitleChange}
          placeholder={t('documents.untitled')}
          type="text"
          value={localTitle}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-4">
        <TipTapEditor
          collabDocId={`document:${documentId}`}
          collabUserName={currentUserName}
          content={doc.content ?? ''}
          mentionUsers={mentionUsers}
          onChange={handleContentChange}
          placeholder={t('documents.startWriting')}
          showToolbar
        />
      </div>
      <ConfirmDialog
        confirmLabel={pendingAction === 'archive' ? t('documents.archive') : t('common.delete')}
        message={
          pendingAction === 'archive'
            ? t('documents.archiveConfirm', { title: doc.title || t('documents.untitled') })
            : t('documents.deleteConfirm', { title: doc.title || t('documents.untitled') })
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) {
            void runAction(action);
          }
        }}
        open={pendingAction !== null}
        title={pendingAction === 'archive' ? t('documents.archive') : t('common.delete')}
      />
    </div>
  );
});
