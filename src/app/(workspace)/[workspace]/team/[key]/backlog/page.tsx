'use client';

import { Bookmark, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BoardControls } from '@/components/issues/board-controls';
import { BoardView } from '@/components/issues/board-view';
import { ColumnPicker } from '@/components/issues/column-picker';
import { CsvExportButton } from '@/components/issues/csv-export-button';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView, type ListGroupBy } from '@/components/issues/issue-list-view';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import {
  ALL_GROUP_OPTIONS,
  DEFAULT_GROUP_OPTIONS,
  ListDisplayControls,
} from '@/components/issues/list-display-controls';
import { ViewToggle } from '@/components/issues/view-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { Button } from '@/components/ui/button';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { type SaveViewInput, SaveViewModal } from '@/components/views/save-view-modal';
import { type ListOrderBy, orderByToSort } from '@/components/views/view-layout';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { buildFilterContext, useFilterLookups } from '@/hooks/use-filter-lookups';
import { useIssueListPage } from '@/hooks/use-issue-list-page';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useIssuesBulkUpdate } from '@/hooks/use-issues-bulk-update';
import { useListDisplayPrefs } from '@/hooks/use-list-display-prefs';
import { useTranslations } from '@/hooks/use-translations';
import { useVisibleColumns } from '@/hooks/use-visible-columns';
import {
  applyFilters,
  applySorting,
  createEmptyFilterSet,
  type FilterSet,
} from '@/lib/filter-engine';
import { gql } from '@/lib/graphql';
import { toIssueDetail, toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

const CUSTOM_VIEW_CREATE_MUTATION = `
  mutation CustomViewCreate($input: CustomViewCreateInput!) {
    customViewCreate(input: $input) {
      success
      lastSyncId
      customView { id name }
    }
  }
`;

/**
 * What "backlog" means: issues in the team's `backlog`-category workflow states
 * (work not yet planned). `unstarted` states (Todo) are NOT backlog — they are
 * accepted, ready work and live on the team page; including them made this page
 * a near-duplicate of it. A team with no backlog-category state falls back to
 * `unstarted` so the page is never a dead end.
 */
function backlogStateTypes(states: { type: string }[]): Set<string> {
  return new Set(states.some(s => s.type === 'backlog') ? ['backlog'] : ['unstarted']);
}

/**
 * Team backlog: the same list/board/timeline surface and display controls
 * (group, order, save view) as the team issues page, restricted to issues in
 * backlog-category workflow states. It used to draw its own rows and so lacked
 * the context menu, board toggle, column picker and CSV export the team page had.
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
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const router = useRouter();
  const { initial: displayPrefs, save: saveDisplayPrefs } = useListDisplayPrefs(
    `${teamKey}:backlog`,
  );
  const [listGroupBy, setListGroupBy] = useState<ListGroupBy>(displayPrefs.listGroupBy);
  const [orderBy, setOrderBy] = useState<ListOrderBy>(displayPrefs.orderBy);

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;
  const basePath = `/${workspace}/team/${teamKey}/backlog`;

  const rawStates = teamId ? workflowStateStore.findByTeamId(teamId) : [];
  // Only the backlog-category states, so the grouped list never shows an
  // empty "In progress" header.
  const backlogTypes = backlogStateTypes(rawStates);
  const states = rawStates.filter(s => backlogTypes.has(s.type));
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

  const lookups = useFilterLookups(teamId);
  const issues = applySorting(
    applyFilters(
      allBacklogIssues,
      filterSet,
      (issueId, definitionId) => customFieldStore.findValue(issueId, definitionId)?.value ?? null,
      buildFilterContext(rawStates),
    ),
    orderByToSort(orderBy),
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
    handleArchiveMany,
    handleDeleteMany,
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
    initialBoardGroupBy: displayPrefs.boardGroupBy,
    initialSwimlaneBy: displayPrefs.swimlaneBy,
    initialViewMode: displayPrefs.viewMode,
    issues,
  });

  useEffect(() => {
    saveDisplayPrefs({
      boardGroupBy,
      completed: displayPrefs.completed,
      listGroupBy,
      orderBy,
      swimlaneBy,
      viewMode,
    });
  }, [
    boardGroupBy,
    displayPrefs.completed,
    listGroupBy,
    orderBy,
    saveDisplayPrefs,
    swimlaneBy,
    viewMode,
  ]);

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

  const csvExport = (
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
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <PageHeader
        actions={
          <>
            {viewMode === 'list' && (
              <ListDisplayControls
                groupBy={listGroupBy}
                groupOptions={ALL_GROUP_OPTIONS}
                mobileExtra={csvExport}
                onGroupBy={setListGroupBy}
                onOrderBy={setOrderBy}
                orderBy={orderBy}
              />
            )}
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
              <Plus className="h-3.5 w-3.5" />
              {t('issues.newIssue')}
            </Button>
          </>
        }
        count={issues.length}
        description={t('issues.backlogDescription')}
        title={t('issues.teamBacklogTitle', { team: team.displayName ?? team.name })}
      />

      {/* Filter bar */}
      <Toolbar className="justify-between">
        <FilterBuilder
          customFields={customFieldDefs}
          cycles={lookups.cycles}
          estimationType={team.issueEstimationType}
          filterSet={filterSet}
          labels={labels}
          onChange={setFilterSet}
          projects={lookups.projects}
          states={states}
          users={users}
        />
        <div className="flex items-center gap-1">
          {viewMode === 'list' && (
            <>
              <div className="max-md:hidden">{csvExport}</div>
              <div className="max-lg:hidden">
                <ColumnPicker
                  customFields={customFieldDefs}
                  estimationType={team.issueEstimationType}
                  isVisible={isColumnVisible}
                  onToggle={toggleColumn}
                />
              </div>
            </>
          )}
          <button
            aria-label={t('issues.saveView')}
            className={cn(
              'flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
              TOUCH_TARGET_SQUARE,
            )}
            onClick={() => setSaveViewOpen(true)}
            title={t('issues.saveCurrentFiltersAsView')}
            type="button"
          >
            <Bookmark className="h-4 w-4" />
          </button>
        </div>
      </Toolbar>

      {/* Backlog list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
            customFields={customFieldDefs}
            cycles={lookups.cycles}
            estimationType={team.issueEstimationType}
            getCustomFieldValue={(issueId, definitionId) =>
              customFieldStore.findValue(issueId, definitionId)?.value ?? null
            }
            groupBy={listGroupBy}
            hasActiveFilters={filterSet.conditions.length > 0}
            isColumnVisible={isColumnVisible}
            issues={issues}
            labels={labels}
            onArchive={handleArchive}
            onArchiveMany={handleArchiveMany}
            onDeleteMany={handleDeleteMany}
            onBulkUpdate={handleBulkUpdate}
            onClearFilters={() => setFilterSet(createEmptyFilterSet())}
            onDelete={requestDelete}
            onOpen={handleOpen}
            onPropertyClosed={() => setOpenProperty(null)}
            onSelect={setSelectedId}
            onUpdate={handleUpdate}
            openProperty={openProperty}
            projects={lookups.projects}
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

      {/* Save the current filters as a view. The backlog scope is written into the
          view as a status condition, so the saved view shows the same issues. */}
      <SaveViewModal
        initialFilters={{
          ...filterSet,
          composition: 'and',
          conditions: [
            { field: 'status', operator: 'in', value: states.map(s => s.id) },
            ...(filterSet.composition === 'and' ? filterSet.conditions : []),
          ],
        }}
        initialGroupBy={
          viewMode === 'board'
            ? boardGroupBy
            : viewMode === 'list' && DEFAULT_GROUP_OPTIONS.includes(listGroupBy)
              ? listGroupBy
              : undefined
        }
        initialLayout={viewMode}
        initialSort={orderByToSort(orderBy)}
        onClose={() => setSaveViewOpen(false)}
        onSubmit={async (input: SaveViewInput) => {
          const res = await gql(CUSTOM_VIEW_CREATE_MUTATION, { input: { ...input, teamId } });
          if (res.errors?.length) {
            throw new Error((res.errors[0] as { message: string }).message);
          }
          const created = (res.data as { customViewCreate?: { customView?: { id?: string } } })
            ?.customViewCreate?.customView;
          toast.success(t('issues.viewSaved'));
          if (created?.id) {
            router.push(`/${workspace}/team/${teamKey}/view/${created.id}`);
          }
        }}
        open={saveViewOpen}
        summary={t('issues.saveViewSummary', {
          count: filterSet.conditions.length + 1,
          layout: t(`issues.layout${viewMode.charAt(0).toUpperCase()}${viewMode.slice(1)}`),
        })}
        teamId={teamId ?? undefined}
      />
    </div>
  );
});

export default BacklogPage;
