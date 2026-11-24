'use client';

import { Archive, FilePlus, FileText, MoreHorizontal, Pencil, Trash2, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import {
  ARCHIVED_DOCUMENTS_QUERY,
  DOCUMENT_ARCHIVE_MUTATION,
  DOCUMENT_DELETE_MUTATION,
  DOCUMENT_UNARCHIVE_MUTATION,
  DOCUMENT_UPDATE_MUTATION,
} from '@/components/documents/document-mutations';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { PromptDialog } from '@/components/shared/prompt-dialog';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Toolbar } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useArchivedLoad } from '@/hooks/use-archived-load';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import type { DBDocument } from '@/lib/db';
import { createDocument, gqlMutate, gqlQuery } from '@/lib/graphql';
import { toIssueUsers } from '@/lib/issue-mappers';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn, getErrorMessage, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface DocumentListProps {
  /** Hide the Active/Archived switch (the project page embeds a compact list). */
  hideArchivedToggle?: boolean;
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

  // `parent` makes the new page a sub-page: it nests under that document and
  // inherits its team/project, so it stays inside the same list and scope.
  const create = useCallback(
    async (parent?: Pick<DBDocument, 'id' | 'projectId' | 'teamId'>) => {
      setCreating(true);
      try {
        const result = await createDocument({
          parentId: parent?.id,
          projectId: parent ? (parent.projectId ?? undefined) : (projectId ?? undefined),
          teamId: parent ? (parent.teamId ?? undefined) : (teamId ?? undefined),
          title: t('documents.untitled'),
        });
        const id = (result.data as { documentCreate?: { document?: { id: string } } })
          ?.documentCreate?.document?.id;
        if (!id) {
          throw new Error('documentCreate returned no document');
        }
        router.push(`/${workspace}/docs/${id}`);
      } catch {
        toast.error(t('documents.createFailed'));
      } finally {
        setCreating(false);
      }
    },
    [projectId, router, t, teamId, workspace],
  );

  return { create, creating };
}

type RowAction = { id: string; kind: 'archive' | 'delete' | 'rename'; title: string };

type ListView = 'active' | 'archived';

export const DocumentList = observer(function DocumentList({
  hideArchivedToggle,
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
  const [view, setView] = useState<ListView>('active');
  const archivedView = view === 'archived';

  // Archived rows are not in the bootstrap, so the Archived view fetches them
  // into the store and reads them back from there.
  const archivedLoad = useArchivedLoad<DBDocument>(
    archivedView,
    () =>
      gqlQuery<DBDocument[]>(
        ARCHIVED_DOCUMENTS_QUERY,
        { projectId: projectId ?? null, teamId: teamId ?? null },
        'documents',
      ).then(rows => rows.filter(d => d.archivedAt)),
    rows => documentStore.upsertMany(rows),
  );

  // Plain selector — observer() picks up the observable reads, so the
  // selector re-runs on any mutation (rename, archive). Memoizing on
  // `pool.size` skipped in-place updates. Most recently edited first, so a
  // pile of "Untitled" drafts at least reads newest-to-oldest.
  const documents = archivedView
    ? documentStore.getArchived({ projectId, teamId })
    : (teamId
        ? documentStore.getByTeamId(teamId)
        : projectId
          ? documentStore.getByProjectId(projectId)
          : documentStore.all.filter(d => !d.parentId)
      )
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // Optimistic: the row leaves at once (the store filters on `archivedAt`) and a
  // refusal puts it back. The toast offers the undo that the old confirm copy
  // ("it will be hidden") never admitted was possible.
  const restore = async (id: string) => {
    documentStore.optimisticUpdate(id, { archivedAt: null });
    try {
      await gqlMutate(DOCUMENT_UNARCHIVE_MUTATION, { id });
    } catch (err) {
      documentStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      toast.error(getErrorMessage(err, t('documents.restoreFailed')));
    }
  };

  const runAction = async (kind: 'archive' | 'delete', id: string) => {
    try {
      await gqlMutate(kind === 'archive' ? DOCUMENT_ARCHIVE_MUTATION : DOCUMENT_DELETE_MUTATION, {
        id,
      });
      if (kind === 'archive') {
        toast.undo(t('documents.documentArchived'), t('common.undo'), () => void restore(id));
      } else {
        toast.success(t('documents.documentDeleted'));
      }
    } catch (err) {
      toast.error(
        getErrorMessage(
          err,
          kind === 'archive' ? t('documents.archiveFailed') : t('documents.deleteFailed'),
        ),
      );
    }
  };

  const toolbar = hideArchivedToggle ? null : (
    <Toolbar>
      <SegmentedControl
        onChange={setView}
        options={[
          { label: t('documents.views.active'), value: 'active' },
          { label: t('documents.views.archived'), value: 'archived' },
        ]}
        value={view}
      />
    </Toolbar>
  );

  if (archivedView && archivedLoad.error) {
    return (
      <>
        {toolbar}
        <InlineRetry message={t('documents.loadArchivedFailed')} onRetry={archivedLoad.retry} />
      </>
    );
  }

  if (archivedView && archivedLoad.loading && documents.length === 0) {
    return (
      <>
        {toolbar}
        <RowsSkeleton className="px-4 py-4" count={4} />
      </>
    );
  }

  if (documents.length === 0) {
    // The shared EmptyState, not a bare grey icon over a text link: this was
    // the fourth distinct empty-state treatment in the app.
    return (
      <>
        {toolbar}
        {archivedView ? (
          <EmptyState
            description={t('documents.archivedEmptyDescription')}
            icon={<Archive className="h-5 w-5" />}
            testId="empty-state"
            title={t('documents.archivedEmptyTitle')}
          />
        ) : (
          <EmptyState
            action={
              <Button
                className="min-w-32"
                disabled={creating}
                onClick={() => void create()}
                size="sm"
              >
                {creating ? t('documents.creating') : t('documents.createFirst')}
              </Button>
            }
            description={t('documents.emptyDescription')}
            icon={<FileText className="h-5 w-5" />}
            testId="empty-state"
            title={t('documents.emptyState')}
          />
        )}
      </>
    );
  }

  const meta = (doc: DBDocument) => {
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

  /** One row plus, recursively, its sub-pages (indented by depth). */
  const renderRow = (doc: DBDocument, depth: number, seen: Set<string>): ReactNode => {
    const displayTitle = doc.title || t('documents.untitled');
    // Sub-pages of an archived page are still live rows, so the Archived view
    // lists archived documents flat and only the Active view nests.
    const children = archivedView || seen.has(doc.id) ? [] : documentStore.getChildren(doc.id);
    const nextSeen = new Set(seen).add(doc.id);
    return (
      <li key={doc.id}>
        <div
          className="group relative flex items-center rounded-md hover:bg-muted focus-within:bg-muted"
          style={depth > 0 ? { paddingLeft: `${depth * 24}px` } : undefined}
        >
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
            <span
              className={cn(
                'min-w-0 flex-1 truncate',
                depth === 0 ? 'font-medium text-foreground' : 'text-foreground-secondary',
              )}
            >
              {displayTitle}
            </span>
            {meta(doc)}
          </Link>
          {archivedView ? (
            <Button
              className="mr-1 shrink-0"
              onClick={() => void restore(doc.id)}
              size="sm"
              variant="outline"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t('common.restore')}
            </Button>
          ) : (
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
                    disabled={creating}
                    onClick={() => {
                      close();
                      void create(doc);
                    }}
                    type="button"
                  >
                    <FilePlus className="h-3.5 w-3.5" />
                    {t('documents.newSubPage')}
                  </button>
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
          )}
        </div>
        {children.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {children.map(child => renderRow(child, depth + 1, nextSeen))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      {toolbar}
      <div className="flex flex-col gap-1 px-4 py-4">
        {/* -mx-2 + px-2 on the row: hover background bleeds out while the icon and
            title line up with the PageHeader title. */}
        <ul className="-mx-2 flex flex-col gap-0.5">
          {documents.map(doc => renderRow(doc, 0, new Set()))}
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
    </>
  );
});
