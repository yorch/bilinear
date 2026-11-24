'use client';

import { Archive, ExternalLink, Flag, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { InitiativeArchivedView } from '@/components/initiatives/initiative-archived-view';
import {
  InitiativeHealthBadge,
  InitiativeHealthProvider,
} from '@/components/initiatives/initiative-health-badge';
import {
  INITIATIVE_UNARCHIVE_MUTATION,
  INITIATIVE_UPDATE_MUTATION,
} from '@/components/initiatives/initiative-mutations';
import { InitiativeUpdatesSection } from '@/components/initiatives/initiative-updates-section';
import { FavoriteToggle } from '@/components/layouts/favorite-toggle';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PromptDialog } from '@/components/shared/prompt-dialog';
import { TabSwitcher, tabPanelProps } from '@/components/shared/tab-switcher';
import { Button } from '@/components/ui/button';
import { ColorDot } from '@/components/ui/color-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { PageSkeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import type { DBInitiative } from '@/lib/db';
import { gql, gqlMutate, gqlQuery } from '@/lib/graphql';
import { toIssueUsers } from '@/lib/issue-mappers';
import { formatDateOnly } from '@/lib/project-dates';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET, TOUCH_TARGET_SQUARE } from '@/lib/utils';
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
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  const { intlLocale } = useFormatters();
  const viewerId = userStore.currentUser?.id ?? '';
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
    // Fetched on mount, not just on expand: the row's own percentage is the
    // mean of these, and the stored `initiative.progress` is a cache that is
    // stale until the next recompute (a freshly seeded initiative read 0%).
    if (projectIds.length === 0) {
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
  }, [projectIdKey, initiative.id]);

  const knownProgress = projectIds
    .map(id => progressById[id])
    .filter((v): v is number => v !== undefined);
  const rolledUp =
    knownProgress.length === projectIds.length && knownProgress.length > 0
      ? knownProgress.reduce((a, b) => a + b, 0) / knownProgress.length
      : initiative.progress;
  const owner = initiative.ownerId ? userStore.findById(initiative.ownerId) : null;
  const target = formatDateOnly(initiative.targetDate, intlLocale);

  // Archive is optimistic: `initiativeStore.all` filters on `archivedAt`, so
  // patching it drops the row at once and the sync action confirms or, on
  // failure, the patch is reverted. Delete waits for the server — a removed
  // row that comes back is more confusing than a short delay.
  const handleArchive = async () => {
    initiativeStore.optimisticUpdate(initiative.id, { archivedAt: new Date().toISOString() });
    try {
      await gqlMutate(INITIATIVE_ARCHIVE_MUTATION, { id: initiative.id });
      toast.undo(t('initiatives.row.archived'), t('common.undo'), () => void handleUnarchive());
    } catch {
      initiativeStore.optimisticUpdate(initiative.id, { archivedAt: null });
      toast.error(t('initiatives.row.archiveFailed'));
    }
  };

  // Optimistic like archive: the pressed state moves at once, and a refusal
  // (or a dropped request) puts the previous status back with a toast rather
  // than leaving the UI claiming a change the server never made.
  const handleStatusChange = async (status: string) => {
    if (status === initiative.status) {
      return;
    }
    const previous = initiative.status;
    initiativeStore.optimisticUpdate(initiative.id, { status });
    try {
      await gqlMutate(INITIATIVE_UPDATE_MUTATION, { id: initiative.id, input: { status } });
    } catch {
      initiativeStore.optimisticUpdate(initiative.id, { status: previous });
      toast.error(t('initiatives.row.statusUpdateFailed'));
    }
  };

  const handleUnarchive = async () => {
    initiativeStore.optimisticUpdate(initiative.id, { archivedAt: null });
    try {
      await gqlMutate(INITIATIVE_UNARCHIVE_MUTATION, { id: initiative.id });
    } catch {
      initiativeStore.optimisticUpdate(initiative.id, {
        archivedAt: new Date().toISOString(),
      });
      toast.error(t('initiatives.row.unarchiveFailed'));
    }
  };

  const handleRename = async (raw: string) => {
    setRenaming(false);
    const name = raw.trim();
    if (!name || name === initiative.name) {
      return;
    }
    const previous = initiative.name;
    initiativeStore.optimisticUpdate(initiative.id, { name });
    try {
      await gqlMutate(INITIATIVE_UPDATE_MUTATION, { id: initiative.id, input: { name } });
    } catch {
      initiativeStore.optimisticUpdate(initiative.id, { name: previous });
      toast.error(t('initiatives.row.renameFailed'));
    }
  };

  const handleDelete = async () => {
    try {
      await gqlMutate(INITIATIVE_DELETE_MUTATION, { id: initiative.id });
      toast.success(t('initiatives.row.deleted'));
    } catch {
      toast.error(t('initiatives.row.deleteFailed'));
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
          aria-expanded={expanded}
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
          {/* No status badge: the group header above the row already says it. */}
          <InitiativeHealthBadge className="shrink-0" compact initiativeId={initiative.id} />
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {t('initiatives.row.projectCount', { count: projectIds.length })}
          </span>
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(rolledUp * 100)}%
          </span>
          <span className="hidden w-24 shrink-0 whitespace-nowrap text-xs text-muted-foreground sm:inline">
            {target}
          </span>
          <span className="flex w-5 shrink-0 justify-end" title={owner?.displayName}>
            {owner && <UserAvatar size="sm" user={toIssueUsers([owner])[0]} />}
          </span>
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
                  router.push(`/${workspace}/initiatives/${initiative.id}`);
                }}
                type="button"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('initiatives.row.open')}
              </button>
              <button
                className={cn(POPOVER_ITEM_CLASS, 'text-foreground-secondary')}
                onClick={() => {
                  close();
                  setRenaming(true);
                }}
                type="button"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('initiatives.row.rename')}
              </button>
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
      <PromptDialog
        initialValue={initiative.name}
        label={t('initiatives.page.namePlaceholder')}
        onCancel={() => setRenaming(false)}
        onSubmit={value => void handleRename(value)}
        open={renaming}
        title={t('initiatives.row.rename')}
      />
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
            <Button onClick={() => setAdding(a => !a)} size="sm" type="button" variant="outline">
              {adding ? t('common.cancel') : t('initiatives.row.addProject')}
            </Button>
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
                    className={POPOVER_ITEM_CLASS}
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
                aria-pressed={initiative.status === s}
                className={cn(
                  'rounded border border-border px-2 py-0.5 text-xs',
                  initiative.status === s
                    ? 'border-brand bg-brand-subtle text-brand-subtle-foreground'
                    : 'border-border',
                )}
                key={s}
                onClick={() => void handleStatusChange(s)}
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
  const [view, setView] = useState<'active' | 'archived'>('active');

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
    <InitiativeHealthProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        <PageHeader
          actions={
            <Button
              onClick={() => setCreating(c => !c)}
              size="sm"
              type="button"
              variant={creating ? 'outline' : 'default'}
            >
              {creating ? (
                t('common.cancel')
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  {t('initiatives.page.newInitiative')}
                </>
              )}
            </Button>
          }
          count={rootInitiatives.length}
          title={t('initiatives.page.title')}
        />

        <Toolbar>
          <TabSwitcher
            ariaLabel={t('initiatives.page.views.label')}
            idPrefix="initiatives-view"
            onChange={setView}
            options={[
              { label: t('initiatives.page.views.active'), value: 'active' },
              { label: t('initiatives.page.views.archived'), value: 'archived' },
            ]}
            value={view}
          />
        </Toolbar>

        {creating && view === 'active' ? (
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

        <div {...tabPanelProps('initiatives-view', view)} className="flex-1 overflow-y-auto">
          {view === 'archived' ? (
            <InitiativeArchivedView />
          ) : grouped.length === 0 ? (
            <EmptyState
              action={
                <Button onClick={() => setCreating(true)} size="sm" type="button">
                  <Plus className="h-3.5 w-3.5" />
                  {t('initiatives.page.newInitiative')}
                </Button>
              }
              description={t('initiatives.page.emptyDescription')}
              icon={<Flag className="h-5 w-5" />}
              testId="empty-state"
              title={t('initiatives.page.emptyTitle')}
            />
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
    </InitiativeHealthProvider>
  );
});

export default InitiativesPage;
