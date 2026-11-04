'use client';

import { Archive, ArrowLeft, ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DOCUMENT_ARCHIVE_MUTATION,
  DOCUMENT_DELETE_MUTATION,
  DOCUMENT_UPDATE_MUTATION,
} from '@/components/documents/document-mutations';
import { createSaveQueue, type SaveStatus } from '@/components/documents/document-save-queue';
import type { MentionItem } from '@/components/editor/mention-list';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn, getErrorMessage, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

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

  // Controlled local title — initialised from store, updated on remote sync.
  const [localTitle, setLocalTitle] = useState(doc?.title ?? '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // One queue, two independent debounced fields. Flushed (not dropped) on
  // unmount so leaving the page inside the debounce window keeps the edit.
  const saveQueue = useMemo(
    () =>
      createSaveQueue({
        onStatus: setSaveStatus,
        send: (field, value, callbacks) => {
          txQueue.enqueue(
            DOCUMENT_UPDATE_MUTATION,
            { id: documentId, input: { [field]: value } },
            callbacks,
          );
        },
      }),
    [documentId, txQueue],
  );

  useEffect(() => () => saveQueue.flush(), [saveQueue]);

  // Sync title from the store when a remote update arrives — but never over a
  // local edit that is still waiting to be saved OR sent and unacknowledged, or
  // the echo of an earlier save would overwrite what the user has typed since.
  useEffect(() => {
    if (doc?.title !== undefined && !saveQueue.isDirty('title')) {
      setLocalTitle(doc.title);
    }
  }, [doc?.title, saveQueue]);

  // A freshly created document is "Untitled": put the caret in the title with
  // the placeholder text selected so the user can type straight away.
  const autoFocusedRef = useRef(false);
  const isFresh = !!doc && !doc.content && doc.title === t('documents.untitled');
  useEffect(() => {
    if (isFresh && !autoFocusedRef.current && titleRef.current) {
      autoFocusedRef.current = true;
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [isFresh]);

  // Auto-grow the title textarea (long titles wrap instead of clipping).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [localTitle]);

  const handleContentChange = useCallback(
    (html: string) => {
      saveQueue.schedule('content', html);
    },
    [saveQueue],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      // Titles are single-line; strip any pasted newlines.
      const title = e.target.value.replace(/\n/g, ' ');
      setLocalTitle(title);
      saveQueue.schedule('title', title);
    },
    [saveQueue],
  );

  if (!doc) {
    return (
      <EmptyState
        action={
          <Button asChild size="sm" variant="outline">
            <Link href={`/${workspace}/docs`}>{t('documents.backToDocs')}</Link>
          </Button>
        }
        className="flex-1"
        title={t('documents.documentNotFound')}
      />
    );
  }

  // Where "back" goes: the owning team's docs list when there is one, else the
  // workspace-wide docs list. Both archive and delete land here too — the store drops the
  // row either way and staying would render "not found" over it.
  const team = doc.teamId ? teamStore.findById(doc.teamId) : null;
  const docsHref = team ? `/${workspace}/team/${team.key}/docs` : `/${workspace}/docs`;

  const runAction = async (action: 'archive' | 'delete') => {
    saveQueue.cancel();
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
          <div className="flex items-center gap-2">
            <span
              aria-live="polite"
              className="text-xs text-muted-foreground"
              data-testid="document-save-status"
            >
              {saveStatus === 'saving' && t('documents.saving')}
              {saveStatus === 'saved' && t('documents.saved')}
              {saveStatus === 'error' && (
                <button
                  className="text-danger-subtle-foreground underline"
                  onClick={() => saveQueue.retry()}
                  type="button"
                >
                  {t('documents.saveFailed')}
                </button>
              )}
            </span>
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
          </div>
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
          <nav aria-label={t('documents.breadcrumb')} className="flex min-w-0 items-center gap-1">
            {/* Below sm only the document title stays: the back arrow already
                leads to Docs, and the full trail pushed the actions onto
                their own row. */}
            {team && (
              <>
                <Link
                  className={cn(crumbClass, 'max-sm:hidden')}
                  href={`/${workspace}/team/${team.key}`}
                >
                  {team.name}
                </Link>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground max-sm:hidden" />
              </>
            )}
            <Link className={cn(crumbClass, 'max-sm:hidden')} href={docsHref}>
              {t('nav.docs')}
            </Link>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground max-sm:hidden" />
            <span aria-current="page" className="truncate">
              {localTitle || t('documents.untitled')}
            </span>
          </nav>
        }
      />
      <div className="flex-1 overflow-y-auto" ref={bodyRef}>
        <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-8">
          <textarea
            aria-label={t('documents.titleLabel')}
            className="w-full resize-none overflow-hidden border-b border-border bg-transparent pb-3 text-2xl font-bold leading-tight text-foreground outline-none placeholder:text-muted-foreground"
            onChange={handleTitleChange}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                bodyRef.current?.querySelector<HTMLElement>('.ProseMirror')?.focus();
              }
            }}
            placeholder={t('documents.untitled')}
            ref={titleRef}
            rows={1}
            value={localTitle}
          />
          <div className="pt-4">
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
        </div>
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
