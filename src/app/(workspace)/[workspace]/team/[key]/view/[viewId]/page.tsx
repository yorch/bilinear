'use client';

import { Eye, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BoardControls } from '@/components/issues/board-controls';
import { BoardView } from '@/components/issues/board-view';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView } from '@/components/issues/issue-list-view';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { ViewToggle } from '@/components/issues/view-toggle';
import { FavoriteToggle } from '@/components/layouts/favorite-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PromptDialog } from '@/components/shared/prompt-dialog';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { coerceBoardGroupBy, coerceViewMode } from '@/components/views/view-layout';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIssueListPage } from '@/hooks/use-issue-list-page';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useIssuesBulkUpdate } from '@/hooks/use-issues-bulk-update';
import { useTranslations } from '@/hooks/use-translations';
import type { DBCustomView } from '@/lib/db';
import {
  applyFilters,
  applySorting,
  coerceFilterSet,
  coerceSortFields,
  type FilterSet,
} from '@/lib/filter-engine';
import { gqlMutate } from '@/lib/graphql';
import { toIssueDetail, toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

// ---------------------------------------------------------------------------
// GraphQL mutations
// ---------------------------------------------------------------------------

const CUSTOM_VIEW_UPDATE_MUTATION = `
  mutation CustomViewUpdate($id: ID!, $input: CustomViewUpdateInput!) {
    customViewUpdate(id: $id, input: $input) {
      success
      lastSyncId
      customView {
        id organizationId teamId creatorId name description icon color
        filters sort groupBy layout shared sortOrder createdAt updatedAt archivedAt
      }
    }
  }
`;

const CUSTOM_VIEW_DELETE_MUTATION = `
  mutation CustomViewDelete($id: ID!) {
    customViewDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

type ViewMenuAction = 'rename' | 'updateFilters' | 'delete';

/**
 * Saved custom view: the issue list filtered by the view's stored FilterSet.
 * This is the target of the sidebar's per-team view links and view favorites.
 */
const CustomViewPage = observer(function CustomViewPage() {
  const {
    workspace,
    key: teamKey,
    viewId,
  } = useParams<{
    workspace: string;
    key: string;
    viewId: string;
  }>();
  const router = useRouter();
  const t = useTranslations();
  const {
    customFieldStore,
    customViewStore,
    issueStore,
    labelStore,
    syncStore,
    teamStore,
    userStore,
    workflowStateStore,
  } = useStore();

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;
  const view = customViewStore.findById(viewId);
  const teamPath = `/${workspace}/team/${teamKey}`;
  const viewPath = `${teamPath}/view/${viewId}`;

  useDocumentTitle(view?.name);

  const states = teamId ? workflowStateStore.findByTeamId(teamId) : [];
  const customFieldDefs = teamId ? customFieldStore.findDefinitionsByTeamId(teamId) : [];

  // The stored filters seed an editable filter bar; "Update filters" writes
  // the bar's current state back to the view.
  const [filterSet, setFilterSet] = useState<FilterSet>(() => coerceFilterSet(view?.filters));
  const [filterSeedId, setFilterSeedId] = useState<string | null>(view?.id ?? null);
  if (view && view.id !== filterSeedId) {
    setFilterSeedId(view.id);
    setFilterSet(coerceFilterSet(view.filters));
  }

  const allIssues: IssueDetail[] = (() => {
    if (!teamId) {
      return [];
    }
    return issueStore.findByTeamId(teamId).map(i => toIssueDetail(i, labelStore));
  })();

  // Filter, then sort as the view stored it — `sort` used to be persisted and
  // never read, so every saved view came back in pool order.
  const issues = view
    ? applySorting(
        applyFilters(
          allIssues,
          filterSet,
          (issueId, definitionId) =>
            customFieldStore.findValue(issueId, definitionId)?.value ?? null,
        ),
        coerceSortFields(view.sort),
        new Map(states.map(s => [s.id, s.position])),
      )
    : [];

  const users: IssueUser[] = toIssueUsers(userStore.all);
  const labels: IssueLabel[] = toIssueLabels(labelStore.all);

  const handleUpdate = useIssueUpdate();
  const handleBulkUpdate = useIssuesBulkUpdate();

  const {
    boardGroupBy,
    closeDetail,
    deleteDialogProps,
    detailIssue,
    handleArchive,
    handleOpen,
    openProperty,
    requestDelete,
    selectedId,
    setBoardGroupBy,
    setOpenProperty,
    setSelectedId,
    setSwimlaneBy,
    setViewMode,
    swimlaneBy,
    viewMode,
  } = useIssueListPage({
    basePath: viewPath,
    buildHref: id =>
      buildIssueHref(workspace, id, { label: view?.name ?? team?.name ?? teamKey, path: viewPath }),
    initialBoardGroupBy: coerceBoardGroupBy(view?.groupBy),
    initialViewMode: coerceViewMode(view?.layout),
    issues,
  });

  // Honour the stored layout once the view row arrives (it may land after the
  // first render, when the hook's initial values were already taken).
  const storedLayout = view?.layout ?? null;
  const storedGroupBy = view?.groupBy ?? null;
  useEffect(() => {
    if (view) {
      setViewMode(coerceViewMode(storedLayout));
      setBoardGroupBy(coerceBoardGroupBy(storedGroupBy));
    }
  }, [view, storedLayout, storedGroupBy, setViewMode, setBoardGroupBy]);

  // ── View actions ────────────────────────────────────────────────────────────

  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const updateView = useCallback(
    async (input: Record<string, unknown>, successMessage: string) => {
      try {
        const data = await gqlMutate(CUSTOM_VIEW_UPDATE_MUTATION, { id: viewId, input });
        const updated = (data as { customViewUpdate?: { customView?: DBCustomView | null } })
          .customViewUpdate?.customView;
        if (updated) {
          customViewStore.applySyncAction('U', updated.id, updated);
        }
        toast.success(successMessage);
      } catch (err) {
        toast.error(getErrorMessage(err, t('customViews.updateFailed')));
      }
    },
    [customViewStore, viewId, t],
  );

  const handleRename = (name: string) => {
    setRenaming(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === view?.name) {
      return;
    }
    void updateView({ name: trimmed }, t('customViews.renamed'));
  };

  const handleUpdateFilters = () => {
    void updateView(
      {
        filters: filterSet,
        groupBy: viewMode === 'board' ? boardGroupBy : undefined,
        layout: viewMode,
      },
      t('customViews.filtersUpdated'),
    );
  };

  const handleDeleteView = async () => {
    setConfirmingDelete(false);
    try {
      await gqlMutate(CUSTOM_VIEW_DELETE_MUTATION, { id: viewId });
      customViewStore.applySyncAction('D', viewId, null);
      toast.success(t('customViews.deleted'));
      router.push(teamPath);
    } catch (err) {
      toast.error(getErrorMessage(err, t('customViews.deleteFailed')));
    }
  };

  const menuActions: Array<{ danger?: boolean; key: ViewMenuAction; label: string }> = [
    { key: 'rename', label: t('customViews.rename') },
    { key: 'updateFilters', label: t('customViews.updateFilters') },
    { danger: true, key: 'delete', label: t('customViews.delete') },
  ];

  const runMenuAction = (action: ViewMenuAction) => {
    if (action === 'rename') {
      setRenaming(true);
    } else if (action === 'updateFilters') {
      handleUpdateFilters();
    } else {
      setConfirmingDelete(true);
    }
  };

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    // A shaped skeleton rather than a centred "Loading…" string: it tells you
    // what is arriving and keeps the page from jumping when it does.
    return <IssueListSkeleton />;
  }

  if (!view || !team) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('customViews.notFound')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <PageHeader
        actions={
          <>
            {viewMode === 'board' && (
              <BoardControls
                groupBy={boardGroupBy}
                onGroupBy={setBoardGroupBy}
                onSwimlaneBy={setSwimlaneBy}
                swimlaneBy={swimlaneBy}
              />
            )}
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <FavoriteToggle entityId={view.id} entityType="CustomView" />
            <SelectPopover
              align="right"
              panelClassName="w-48 py-1"
              panelDataTestId="view-menu"
              triggerChildren={<MoreHorizontal className="h-4 w-4" />}
              triggerClassName={cn(
                'rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
                TOUCH_TARGET_SQUARE,
              )}
              triggerTitle={t('customViews.viewMenu')}
            >
              {close => (
                <>
                  {menuActions.map(action => (
                    <button
                      className={cn(
                        POPOVER_ITEM_CLASS,
                        action.danger && 'text-danger-subtle-foreground',
                      )}
                      key={action.key}
                      onClick={() => {
                        close();
                        runMenuAction(action.key);
                      }}
                      type="button"
                    >
                      {action.label}
                    </button>
                  ))}
                </>
              )}
            </SelectPopover>
          </>
        }
        count={issues.length}
        description={view.description ?? undefined}
        leading={<Eye className="h-4 w-4 shrink-0 text-muted-foreground" />}
        title={view.name}
      />

      {/* Filter bar — seeded from the view, saved back via "Update filters" */}
      <Toolbar>
        <FilterBuilder
          customFields={customFieldDefs}
          filterSet={filterSet}
          labels={labels}
          onChange={setFilterSet}
          states={states}
          users={users}
        />
      </Toolbar>

      {/* Filtered list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
            customFields={customFieldDefs}
            getCustomFieldValue={(issueId, definitionId) =>
              customFieldStore.findValue(issueId, definitionId)?.value ?? null
            }
            issues={issues}
            labels={labels}
            onArchive={handleArchive}
            onBulkUpdate={handleBulkUpdate}
            onDelete={requestDelete}
            onOpen={handleOpen}
            onPropertyClosed={() => setOpenProperty(null)}
            onSelect={setSelectedId}
            onUpdate={handleUpdate}
            openProperty={openProperty}
            selectedId={selectedId}
            states={states}
            teamId={teamId ?? undefined}
            users={users}
          />
        ) : viewMode === 'timeline' ? (
          <GanttView
            emptyMessage={t('issues.ganttEmptyMessage')}
            items={issues
              .filter(i => i.startDate ?? i.dueDate)
              .map<GanttItem>(i => ({
                endDate: i.dueDate ?? null,
                id: i.id,
                name: `${i.identifier} ${i.title}`,
                startDate: i.startDate ?? null,
                subtitle: states.find(s => s.id === i.stateId)?.name ?? undefined,
              }))}
            onChange={(id, startDate, endDate) => {
              handleUpdate(id, { dueDate: endDate, startDate });
            }}
          />
        ) : (
          <BoardView
            groupBy={boardGroupBy}
            issues={issues}
            labels={labels}
            onOpen={handleOpen}
            onSelect={setSelectedId}
            onUpdate={handleUpdate}
            selectedId={selectedId}
            states={states}
            swimlaneBy={swimlaneBy}
            users={users}
          />
        )}
      </div>

      {/* Detail panel (lazy-loaded) */}
      <LazyIssueDetailPanel
        issue={detailIssue}
        labels={labels}
        onClose={closeDetail}
        onUpdate={handleUpdate}
        states={states}
        users={users}
      />

      {/* Issue delete confirmation (context menu) */}
      <ConfirmDialog {...deleteDialogProps} />

      {/* Rename */}
      <PromptDialog
        initialValue={view.name}
        label={t('properties.saveView.name')}
        onCancel={() => setRenaming(false)}
        onSubmit={handleRename}
        open={renaming}
        title={t('customViews.rename')}
      />

      {/* Delete view confirmation */}
      <ConfirmDialog
        message={t('customViews.deleteConfirmBody', { name: view.name })}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => void handleDeleteView()}
        open={confirmingDelete}
        title={t('customViews.deleteConfirmTitle')}
      />
    </div>
  );
});

export default CustomViewPage;
