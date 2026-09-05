'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BoardControls } from '@/components/issues/board-controls';
import { BoardView } from '@/components/issues/board-view';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView } from '@/components/issues/issue-list-view';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { ViewToggle } from '@/components/issues/view-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIssueListPage } from '@/hooks/use-issue-list-page';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useIssuesBulkUpdate } from '@/hooks/use-issues-bulk-update';
import { useTranslations } from '@/hooks/use-translations';
import { applyFilters, createEmptyFilterSet, type FilterSet } from '@/lib/filter-engine';
import { toIssueDetail, toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const MyIssuesPage = observer(function MyIssuesPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const t = useTranslations();
  const { issueStore, userStore, workflowStateStore, labelStore, syncStore } = useStore();

  useDocumentTitle(t('nav.myIssues'));

  // UI state
  const [filterSet, setFilterSet] = useState<FilterSet>(createEmptyFilterSet());

  // ── Store-derived values ─────────────────────────────────────────────────

  const currentUser = userStore.currentUser;

  // All non-trashed, non-archived issues assigned to the current user,
  // across every team. Deps: pool.size catches adds/removes; userStore.pool.size
  // catches the current user resolving after bootstrap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const allMyIssues: IssueDetail[] = useMemo(() => {
    if (!currentUser) {
      return [];
    }
    return Array.from(issueStore.pool.values())
      .filter(i => i.assigneeId === currentUser.id && !i.trashed && !i.archivedAt)
      .map(i => toIssueDetail(i, labelStore))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [issueStore.pool.size, userStore.pool.size, currentUser, issueStore, labelStore]);

  // All active workflow states across all teams (for grouping + filter options).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const states = useMemo(() => workflowStateStore.all, [workflowStateStore.pool.size]);

  const issues = applyFilters(allMyIssues, filterSet);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const users: IssueUser[] = useMemo(() => toIssueUsers(userStore.all), [userStore.pool.size]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const labels: IssueLabel[] = useMemo(() => toIssueLabels(labelStore.all), [labelStore.pool.size]);

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  // ── Mutations ─────────────────────────────────────────────────────────────

  const handleUpdate = useIssueUpdate();
  const handleBulkUpdate = useIssuesBulkUpdate();

  // ── Selection, detail panel, view mode, keyboard shortcuts ──────────────────

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
    basePath: `/${workspace}/my-issues`,
    buildHref: id =>
      buildIssueHref(workspace, id, { label: t('nav.myIssues'), path: `/${workspace}/my-issues` }),
    issues,
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    // A shaped skeleton rather than a centred "Loading…" string: it tells you
    // what is arriving and keeps the page from jumping when it does.
    return <IssueListSkeleton />;
  }

  if (hasError) {
    return <SyncErrorState message={t('issues.failedToLoad')} />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
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
          </>
        }
        count={issues.length}
        title={t('issues.myIssues')}
      />

      <Toolbar>
        <FilterBuilder
          filterSet={filterSet}
          labels={labels}
          onChange={setFilterSet}
          states={states}
          users={users}
        />
      </Toolbar>

      {/* Issue list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
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

      {/* Detail panel */}
      <LazyIssueDetailPanel
        issue={detailIssue}
        labels={labels}
        onClose={closeDetail}
        onUpdate={handleUpdate}
        states={states}
        users={users}
      />

      {/* Delete confirmation (context menu) */}
      <ConfirmDialog {...deleteDialogProps} />
    </div>
  );
});

export default MyIssuesPage;
