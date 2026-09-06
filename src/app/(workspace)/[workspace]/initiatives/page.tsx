'use client';

import { Archive, Flag, MoreHorizontal, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { InitiativeUpdatesSection } from '@/components/initiatives/initiative-updates-section';
import { FavoriteToggle } from '@/components/layouts/favorite-toggle';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ColorDot } from '@/components/ui/color-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { PageSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import type { DBInitiative } from '@/lib/db';
import { gql, gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Initiatives — top-level strategic groupings of projects toward a
 * multi-quarter goal. Progress rolls up from linked projects.
 */

const INITIATIVE_CREATE_MUTATION = `
  mutation InitiativeCreate($input: InitiativeCreateInput!) {
    initiativeCreate(input: $input) {
      success
      lastSyncId
      initiative {
        id
        name
        status
        progress
        targetDate
      }
    }
  }
`;

const INITIATIVE_UPDATE_MUTATION = `
  mutation InitiativeUpdate($id: ID!, $input: InitiativeUpdateInput!) {
    initiativeUpdate(id: $id, input: $input) {
      success
      lastSyncId
      initiative { id status }
    }
  }
`;

const INITIATIVE_ADD_PROJECT_MUTATION = `
  mutation InitiativeAddProject($initiativeId: ID!, $projectId: ID!) {
    initiativeAddProject(initiativeId: $initiativeId, projectId: $projectId) {
      success
      lastSyncId
    }
  }
`;

const INITIATIVE_REMOVE_PROJECT_MUTATION = `
  mutation InitiativeRemoveProject($initiativeId: ID!, $projectId: ID!) {
    initiativeRemoveProject(initiativeId: $initiativeId, projectId: $projectId) {
      success
      lastSyncId
    }
  }
`;

const INITIATIVE_ARCHIVE_MUTATION = `
  mutation InitiativeArchive($id: ID!) { initiativeArchive(id: $id) { success lastSyncId } }
`;

const INITIATIVE_DELETE_MUTATION = `
  mutation InitiativeDelete($id: ID!) { initiativeDelete(id: $id) { success lastSyncId } }
`;

const INITIATIVE_PROJECT_PROGRESS_QUERY = `
  query InitiativeProjectProgress($id: ID!) {
    initiative(id: $id) {
      id
      projects { id progress }
    }
  }
`;

const STATUS_ORDER = ['active', 'planned', 'completed', 'canceled'];

function useStatusLabels() {
  const t = useTranslations();
  return {
    active: t('initiatives.status.active'),
    canceled: t('initiatives.status.canceled'),
    completed: t('initiatives.status.completed'),
    planned: t('initiatives.status.planned'),
  } as Record<string, string>;
}

function InitiativeRow({ depth = 0, initiative }: { depth?: number; initiative: DBInitiative }) {
  const t = useTranslations();
  const STATUS_LABELS = useStatusLabels();
  const { initiativeStore, projectStore, userStore } = useStore();
  const viewerId = userStore.currentUser?.id ?? '';
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingAction, setPendingAction] = useState<'archive' | 'delete' | null>(null);
  // Progress must come from the server. Computing it from `issueStore` divides
  // over whatever issues this client happens to hold, and a guest's pool is
  // scoped to issues they created or are assigned — so one owned issue in a
  // 50-issue project renders as 100%. `Project.progress` is resolved from the
  // full issue set server-side.
  const [progressById, setProgressById] = useState<Record<string, number>>({});
  const children = initiativeStore.getChildren(initiative.id);
  const projectIds = initiativeStore.getProjectIds(initiative.id);
  const projects = projectIds
    .map(id => projectStore.findById(id))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const allProjects = projectStore.all.filter(p => !projectIds.includes(p.id));

  const projectIdKey = projectIds.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectIdKey is the stable stand-in for the projectIds array
  useEffect(() => {
    if (!expanded || projectIds.length === 0) {
      return;
    }
    gqlQuery<{ projects: Array<{ id: string; progress: number }> } | null>(
      INITIATIVE_PROJECT_PROGRESS_QUERY,
      { id: initiative.id },
      'initiative',
    )
      .then(data => {
        setProgressById(Object.fromEntries((data?.projects ?? []).map(p => [p.id, p.progress])));
      })
      .catch(() => {
        // Leave the map empty — the row renders '—' rather than a wrong number.
        setProgressById({});
      });
  }, [expanded, projectIdKey, initiative.id]);

  // Archive is optimistic: `initiativeStore.all` filters on `archivedAt`, so
  // patching it drops the row at once and the sync action confirms or, on
  // failure, the patch is reverted. Delete waits for the server — a removed
  // row that comes back is more confusing than a short delay.
  const handleArchive = async () => {
    initiativeStore.optimisticUpdate(initiative.id, { archivedAt: new Date().toISOString() });
    try {
      await gqlMutate(INITIATIVE_ARCHIVE_MUTATION, { id: initiative.id });
      toast.success(t('initiatives.row.archived'));
    } catch (err) {
      initiativeStore.optimisticUpdate(initiative.id, { archivedAt: null });
      toast.error(getErrorMessage(err, t('initiatives.row.archiveFailed')));
    }
  };

  const handleDelete = async () => {
    try {
      await gqlMutate(INITIATIVE_DELETE_MUTATION, { id: initiative.id });
      toast.success(t('initiatives.row.deleted'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('initiatives.row.deleteFailed')));
    }
  };

  const indentPx = depth * 20;
  return (
    <div className="border-b border-border" data-testid="initiative-row">
      <div
        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-accent/50"
        style={{ paddingLeft: `${16 + indentPx}px` }}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setExpanded(e => !e)}
          type="button"
        >
          {children.length > 0 && (
            <span
              className={cn(
                'text-muted-foreground text-xs shrink-0 transition-transform',
                expanded && 'rotate-90',
              )}
            >
              ▶
            </span>
          )}
          <span
            className="inline-block h-3 w-3 shrink-0 rounded"
            style={{ backgroundColor: initiative.color }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {initiative.name}
            </span>
            {initiative.description ? (
              <span className="block truncate text-xs text-muted-foreground">
                {initiative.description}
              </span>
            ) : null}
          </span>
          <Badge className="text-foreground-secondary" tone="muted" variant="square">
            {STATUS_LABELS[initiative.status] ?? initiative.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {Math.round(initiative.progress * 100)}%
          </span>
          <span className="w-20 text-xs text-muted-foreground">{initiative.targetDate ?? ''}</span>
        </button>
        <FavoriteToggle className="h-7 w-7" entityId={initiative.id} entityType="Initiative" />
        <SelectPopover
          align="right"
          panelClassName="min-w-[160px] py-1"
          triggerChildren={<MoreHorizontal className="h-4 w-4" />}
          triggerClassName={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
            TOUCH_TARGET_SQUARE,
          )}
          triggerTitle={t('initiatives.row.moreActions')}
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
                {t('initiatives.row.archive')}
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
      <ConfirmDialog
        confirmLabel={
          pendingAction === 'archive' ? t('initiatives.row.archive') : t('common.delete')
        }
        message={
          pendingAction === 'archive'
            ? t('initiatives.row.archiveConfirm', { name: initiative.name })
            : t('initiatives.row.deleteConfirm', { name: initiative.name })
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === 'archive') {
            void handleArchive();
          } else if (action === 'delete') {
            void handleDelete();
          }
        }}
        open={pendingAction !== null}
        title={pendingAction === 'archive' ? t('initiatives.row.archive') : t('common.delete')}
      />
      {expanded ? (
        <div className="px-12 pb-3" data-testid="initiative-projects">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-secondary">
              {t('initiatives.row.projects', { count: projects.length })}
            </span>
            <button
              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
              onClick={() => setAdding(a => !a)}
              type="button"
            >
              {adding ? t('common.cancel') : t('initiatives.row.addProject')}
            </button>
          </div>
          {adding ? (
            <div className="mb-2 max-h-40 overflow-y-auto rounded border border-border">
              {allProjects.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t('initiatives.row.noProjectsToAdd')}
                </div>
              ) : (
                allProjects.map(p => (
                  <button
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
                    key={p.id}
                    onClick={async () => {
                      const res = await gql(INITIATIVE_ADD_PROJECT_MUTATION, {
                        initiativeId: initiative.id,
                        projectId: p.id,
                      });
                      if (res.errors?.length) {
                        toast.error(t('initiatives.row.addProjectFailed'));
                      } else {
                        toast.success(t('initiatives.row.addedProject', { name: p.name }));
                        setAdding(false);
                      }
                    }}
                    type="button"
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
          {projects.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {t('initiatives.row.noProjectsYet')}
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map(p => (
                <div
                  className="flex items-center gap-2 text-xs text-foreground-secondary"
                  key={p.id}
                >
                  <ColorDot color={p.color} size="sm" />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-muted-foreground">
                    {progressById[p.id] === undefined
                      ? '—'
                      : `${Math.round(progressById[p.id] * 100)}%`}
                  </span>
                  <button
                    className={cn(
                      'text-muted-foreground hover:text-danger-subtle-foreground',
                      TOUCH_TARGET,
                    )}
                    onClick={async () => {
                      const res = await gql(INITIATIVE_REMOVE_PROJECT_MUTATION, {
                        initiativeId: initiative.id,
                        projectId: p.id,
                      });
                      if (res.errors?.length) {
                        toast.error(
                          (res.errors[0] as { message?: string })?.message ??
                            t('initiatives.row.removeProjectFailed'),
                        );
                      } else {
                        toast.success(t('initiatives.row.removedProject', { name: p.name }));
                      }
                    }}
                    title={t('initiatives.row.removeProjectTitle', { name: p.name })}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-1">
            {STATUS_ORDER.map(s => (
              <button
                className={cn(
                  'rounded border px-2 py-0.5 text-xs',
                  initiative.status === s
                    ? 'border-brand bg-brand-subtle text-brand-subtle-foreground'
                    : 'border-border',
                )}
                key={s}
                onClick={async () => {
                  await gql(INITIATIVE_UPDATE_MUTATION, {
                    id: initiative.id,
                    input: { status: s },
                  });
                }}
                type="button"
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <InitiativeUpdatesSection initiativeId={initiative.id} viewerId={viewerId} />
        </div>
      ) : null}
      {/* Sub-initiatives — rendered regardless of expansion so the tree is always visible */}
      {children.map(child => (
        <InitiativeRow depth={depth + 1} initiative={child} key={child.id} />
      ))}
    </div>
  );
}

const InitiativesPage = observer(function InitiativesPage() {
  const t = useTranslations();
  useDocumentTitle(t('initiatives.page.title'));
  const STATUS_LABELS = useStatusLabels();
  const { initiativeStore, syncStore } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  // Only top-level (root) initiatives — children render recursively inside InitiativeRow.
  const rootInitiatives = initiativeStore.roots;
  const grouped = STATUS_ORDER.map(status => ({
    items: rootInitiatives.filter(i => i.status === status),
    status,
  })).filter(g => g.items.length > 0);

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }
    const res = await gql(INITIATIVE_CREATE_MUTATION, { input: { name: name.trim() } });
    if (res.errors?.length) {
      toast.error(t('initiatives.page.createFailed'));
    } else {
      toast.success(t('initiatives.page.createdSuccess'));
      setName('');
      setCreating(false);
    }
  };

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        actions={
          <Button
            onClick={() => setCreating(c => !c)}
            size="sm"
            type="button"
            variant={creating ? 'outline' : 'default'}
          >
            {creating ? t('common.cancel') : t('initiatives.page.newInitiative')}
          </Button>
        }
        title={t('initiatives.page.title')}
      />

      {creating ? (
        <Toolbar>
          <Input
            className="flex-1"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleCreate();
              } else if (e.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
            placeholder={t('initiatives.page.namePlaceholder')}
            ref={inputRef}
            value={name}
          />
          <Button onClick={handleCreate} size="sm" type="button">
            {t('common.create')}
          </Button>
        </Toolbar>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <EmptyState icon={<Flag className="h-5 w-5" />} title={t('initiatives.page.empty')} />
        ) : (
          grouped.map(({ status, items }) => (
            <div key={status}>
              <div className="border-b border-border bg-card px-4 py-1.5">
                <span className="text-xs font-medium text-foreground-secondary">
                  {STATUS_LABELS[status]}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">{items.length}</span>
              </div>
              {items.map(initiative => (
                <InitiativeRow initiative={initiative} key={initiative.id} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default InitiativesPage;
