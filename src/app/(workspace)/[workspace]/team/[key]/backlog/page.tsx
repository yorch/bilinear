'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BoardControls } from '@/components/issues/board-controls';
import { BoardView } from '@/components/issues/board-view';
import { ColumnPicker } from '@/components/issues/column-picker';
import { CsvExportButton } from '@/components/issues/csv-export-button';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView } from '@/components/issues/issue-list-view';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { ViewToggle } from '@/components/issues/view-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { Button } from '@/components/ui/button';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIssueListPage } from '@/hooks/use-issue-list-page';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useIssuesBulkUpdate } from '@/hooks/use-issues-bulk-update';
import { useTranslations } from '@/hooks/use-translations';
import { useVisibleColumns } from '@/hooks/use-visible-columns';
import { applyFilters, createEmptyFilterSet, type FilterSet } from '@/lib/filter-engine';
import { toIssueDetail, toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

/** Workflow state categories the backlog page shows. */
const BACKLOG_STATE_TYPES = new Set(['backlog', 'unstarted']);

/**
 * Team backlog: the same list/board/timeline surface as the team issues page,
 * restricted to issues in backlog-category workflow states. It used to draw its
 * own rows and so lacked the context menu, board toggle, column picker and CSV
 * export the team page had.
 */
const BacklogPage = observer(function BacklogPage() {
  const { workspace, key: teamKey } = useParams<{ workspace: string; key: string }>();
  const t = useTranslations();
  const {
    issueStore,
    teamStore,
    userStore,
    workflowStateStore,
    labelStore,
    customFieldStore,
    projectStore,
    cycleStore,
    syncStore,
    uiStore,
  } = useStore();

  useDocumentTitle(t('nav.backlog'));
  const [filterSet, setFilterSet] = useState<FilterSet>(createEmptyFilterSet());

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;
  const basePath = `/${workspace}/team/${teamKey}/backlog`;

  const rawStates = teamId ? workflowStateStore.findByTeamId(teamId) : [];
  // Only the backlog-category states, so the grouped list never shows an
  // empty "In progress" header.
  const states = rawStates.filter(s => BACKLOG_STATE_TYPES.has(s.type));
  const backlogStateIds = new Set(states.map(s => s.id));

  // Plain selectors rather than useMemo — see team/[key]/page.tsx for why
  // memoising on `.size` misses in-place mutations.
  const allBacklogIssues: IssueDetail[] = (() => {
    if (!teamId) {
      return [];
    }
    const statePositionMap = new Map(states.map(s => [s.id, s.position]));
    return issueStore
      .findByTeamId(teamId)
      .filter(i => backlogStateIds.has(i.stateId))
      .map(i => toIssueDetail(i, labelStore))
      .sort((a, b) => {
        const posA = statePositionMap.get(a.stateId) ?? 0;
        const posB = statePositionMap.get(b.stateId) ?? 0;
        if (posA !== posB) {
          return posA - posB;
        }
        return a.sortOrder - b.sortOrder;
      });
  })();

  const customFieldDefs = teamId ? customFieldStore.findDefinitionsByTeamId(teamId) : [];
  const { isVisible: isColumnVisible, toggle: toggleColumn } = useVisibleColumns(
    `${teamId ?? 'no-team'}:backlog`,
  );

  const issues = applyFilters(
    allBacklogIssues,
    filterSet,
    (issueId, definitionId) => customFieldStore.findValue(issueId, definitionId)?.value ?? null,
  );

  const users: IssueUser[] = toIssueUsers(userStore.all);
  const labels: IssueLabel[] = toIssueLabels(labelStore.all);

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  // ── Mutations, selection, shortcuts ─────────────────────────────────────

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
    basePath,
    buildHref: id => buildIssueHref(workspace, id, { label: t('nav.backlog'), path: basePath }),
    issues,
  });

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    // A shaped skeleton rather than a centred "Loading…" string: it tells you
    // what is arriving and keeps the page from jumping when it does.
    return <IssueListSkeleton />;
  }

  if (hasError) {
    return <SyncErrorState message={t('issues.failedToLoad')} />;
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('issues.teamNotFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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
            <Button onClick={() => uiStore.openCreateIssueModal()} size="sm" type="button">
              {t('issues.newIssue')}
            </Button>
          </>
        }
        count={issues.length}
        title={t('issues.teamBacklogTitle', { team: team.displayName ?? team.name })}
      />

      {/* Filter bar */}
      <Toolbar className="justify-between">
        <FilterBuilder
          customFields={customFieldDefs}
          filterSet={filterSet}
          labels={labels}
          onChange={setFilterSet}
          states={states}
          users={users}
        />
        {viewMode === 'list' && (
          <div className="flex items-center gap-1">
            <CsvExportButton
              customFields={customFieldDefs}
              cyclesById={
                new Map(
                  Array.from(cycleStore.pool.values()).map(c => [
                    c.id,
                    { name: c.name ?? null, number: c.number },
                  ]),
                )
              }
              getCustomFieldValue={(issueId, definitionId) =>
                customFieldStore.findValue(issueId, definitionId)?.value ?? null
              }
              issues={issues}
              projectsById={
                new Map(Array.from(projectStore.pool.values()).map(p => [p.id, { name: p.name }]))
              }
              states={states}
              stem={`team-${team.key}-backlog`}
              users={users}
            />
            <ColumnPicker
              customFields={customFieldDefs}
              isVisible={isColumnVisible}
              onToggle={toggleColumn}
            />
          </div>
        )}
      </Toolbar>

      {/* Backlog list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
            customFields={customFieldDefs}
            getCustomFieldValue={(issueId, definitionId) =>
              customFieldStore.findValue(issueId, definitionId)?.value ?? null
            }
            isColumnVisible={isColumnVisible}
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

      {/* Delete confirmation (context menu) */}
      <ConfirmDialog {...deleteDialogProps} />
    </div>
  );
});

export default BacklogPage;
