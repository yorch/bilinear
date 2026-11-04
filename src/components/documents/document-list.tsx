'use client';

import { Archive, FileText, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  DOCUMENT_ARCHIVE_MUTATION,
  DOCUMENT_DELETE_MUTATION,
  DOCUMENT_UPDATE_MUTATION,
} from '@/components/documents/document-mutations';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PromptDialog } from '@/components/shared/prompt-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { createDocument, gqlMutate } from '@/lib/graphql';
import { toIssueUsers } from '@/lib/issue-mappers';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn, getErrorMessage, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface DocumentListProps {
  projectId?: string;
  teamId?: string;
}

/**
 * Create a document and navigate to it.
 *
 * Extracted so the *page* can own the "New document" button and put it in its
 * `PageHeader` action slot. The list used to render its own `<h2>Documents</h2>`
 * plus a create button, directly under the page's own `PageHeader` — two
 * stacked headers for one page, with the primary action attached to the
 * lower one.
 */
export function useCreateDocument({ projectId, teamId }: DocumentListProps) {
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  const t = useTranslations();
  const [creating, setCreating] = useState(false);

  const create = useCallback(async () => {
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
  }, [projectId, router, t, teamId, workspace]);

  return { create, creating };
}

type RowAction = { id: string; kind: 'archive' | 'delete' | 'rename'; title: string };

export const DocumentList = observer(function DocumentList({
  teamId,
  projectId,
}: DocumentListProps) {
  const { workspace } = useParams<{ workspace: string }>();
  const { documentStore, userStore } = useStore();
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const { create, creating } = useCreateDocument({ projectId, teamId });
  const txQueue = useMemo(() => new TransactionQueue(), []);
  const [action, setAction] = useState<RowAction | null>(null);

  // Plain selector — observer() picks up the observable reads, so the
  // selector re-runs on any mutation (rename, archive). Memoizing on
  // `pool.size` skipped in-place updates. Most recently edited first, so a
  // pile of "Untitled" drafts at least reads newest-to-oldest.
  const documents = (
    teamId
      ? documentStore.getByTeamId(teamId)
      : projectId
        ? documentStore.getByProjectId(projectId)
        : documentStore.all.filter(d => !d.parentId)
  )
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const runAction = async (kind: 'archive' | 'delete', id: string) => {
    try {
      await gqlMutate(kind === 'archive' ? DOCUMENT_ARCHIVE_MUTATION : DOCUMENT_DELETE_MUTATION, {
        id,
      });
      toast.success(
        kind === 'archive' ? t('documents.documentArchived') : t('documents.documentDeleted'),
      );
    } catch (err) {
      toast.error(
        getErrorMessage(
          err,
          kind === 'archive' ? t('documents.archiveFailed') : t('documents.deleteFailed'),
        ),
      );
    }
  };

  if (documents.length === 0) {
    // The shared EmptyState, not a bare grey icon over a text link: this was
    // the fourth distinct empty-state treatment in the app.
    return (
      <EmptyState
        action={
          <Button className="min-w-32" disabled={creating} onClick={() => void create()} size="sm">
            {creating ? t('documents.creating') : t('documents.createFirst')}
          </Button>
        }
        description={t('documents.emptyDescription')}
        icon={<FileText className="h-5 w-5" />}
        testId="empty-state"
        title={t('documents.emptyState')}
      />
    );
  }

  const meta = (doc: (typeof documents)[number]) => {
    const author = doc.creatorId ? userStore.findById(doc.creatorId) : null;
    return (
      <span className="flex shrink-0 items-center gap-2">
        {author && <UserAvatar size="xs" user={toIssueUsers([author])[0]} />}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(doc.updatedAt)}
        </span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-1 px-4 py-4">
      {/* -mx-2 + px-2 on the row: hover background bleeds out while the icon and
          title line up with the PageHeader title. */}
      <ul className="-mx-2 flex flex-col gap-0.5">
        {documents.map(doc => {
          const displayTitle = doc.title || t('documents.untitled');
          return (
            <li key={doc.id}>
              <div className="group relative flex items-center rounded-md hover:bg-muted focus-within:bg-muted">
                <Link
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground-secondary"
                  href={`/${workspace}/docs/${doc.id}`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    {doc.icon ? (
                      <span className="text-sm">{doc.icon}</span>
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {displayTitle}
                  </span>
                  {meta(doc)}
                </Link>
                <SelectPopover
                  align="right"
                  panelClassName="min-w-[160px] py-1"
                  triggerChildren={<MoreHorizontal className="h-4 w-4" />}
                  triggerClassName={cn(
                    'mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground-secondary',
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
                          setAction({ id: doc.id, kind: 'rename', title: doc.title });
                        }}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t('documents.rename')}
                      </button>
                      <button
                        className={cn(POPOVER_ITEM_CLASS, 'text-foreground-secondary')}
                        onClick={() => {
                          close();
                          setAction({ id: doc.id, kind: 'archive', title: displayTitle });
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
                          setAction({ id: doc.id, kind: 'delete', title: displayTitle });
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
                      <FileText className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {child.title || t('documents.untitled')}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {formatRelativeTime(child.updatedAt)}
                  </span>
                </Link>
              ))}
            </li>
          );
        })}
      </ul>
      <PromptDialog
        initialValue={action?.kind === 'rename' ? action.title : ''}
        label={t('documents.titleLabel')}
        onCancel={() => setAction(null)}
        onSubmit={value => {
          const target = action;
          setAction(null);
          const title = value.trim();
          if (target?.kind === 'rename' && title) {
            txQueue.enqueue(DOCUMENT_UPDATE_MUTATION, { id: target.id, input: { title } }, {});
          }
        }}
        open={action?.kind === 'rename'}
        title={t('documents.rename')}
      />
      <ConfirmDialog
        confirmLabel={action?.kind === 'archive' ? t('documents.archive') : t('common.delete')}
        message={
          action?.kind === 'archive'
            ? t('documents.archiveConfirm', { title: action.title })
            : t('documents.deleteConfirm', { title: action?.title ?? '' })
        }
        onCancel={() => setAction(null)}
        onConfirm={() => {
          const target = action;
          setAction(null);
          if (target && target.kind !== 'rename') {
            void runAction(target.kind, target.id);
          }
        }}
        open={action !== null && action.kind !== 'rename'}
        title={action?.kind === 'archive' ? t('documents.archive') : t('common.delete')}
      />
    </div>
  );
});
