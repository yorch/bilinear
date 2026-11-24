'use client';

import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BoardControls } from '@/components/issues/board-controls';
import { BoardView } from '@/components/issues/board-view';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView, type ListGroupBy } from '@/components/issues/issue-list-view';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { ALL_GROUP_OPTIONS, ListDisplayControls } from '@/components/issues/list-display-controls';
import { ViewToggle } from '@/components/issues/view-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionHeader } from '@/components/shared/section-header';
import { SyncErrorState } from '@/components/shared/sync-error-state';
import { Button } from '@/components/ui/button';
import { PageHeader, Toolbar } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { IssueListSkeleton } from '@/components/ui/skeleton';
import { type ListOrderBy, orderByToSort } from '@/components/views/view-layout';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { buildFilterContext, useFilterLookups } from '@/hooks/use-filter-lookups';
import { useIssueListPage } from '@/hooks/use-issue-list-page';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useIssuesBulkUpdate } from '@/hooks/use-issues-bulk-update';
import { useListDisplayPrefs } from '@/hooks/use-list-display-prefs';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import {
  applyFilters,
  applySorting,
  createEmptyFilterSet,
  type FilterSet,
} from '@/lib/filter-engine';
import { gqlQuery } from '@/lib/graphql';
import {
  type CompletedIssuesMode,
  filterCompletedIssues,
  stateIdsOfType,
} from '@/lib/issue-list-visibility';
import { toIssueDetail, toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { disambiguateStateNames, groupIssuesByTeam } from '@/lib/multi-team-issues';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

/** Which relationship to the viewer the list is answering for. */
type MyIssuesScope = 'assigned' | 'created' | 'subscribed';

const SUBSCRIBED_IDS_QUERY = `
  query NotificationSubscribedIssueIds {
    notificationSubscribedIssueIds
  }
`;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const MyIssuesPage = observer(function MyIssuesPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const t = useTranslations();
  const { issueStore, userStore, workflowStateStore, labelStore, syncStore, teamStore, uiStore } =
    useStore();

  useDocumentTitle(t('nav.myIssues'));

  // UI state
  const [filterSet, setFilterSet] = useState<FilterSet>(createEmptyFilterSet());
  const [scope, setScope] = useState<MyIssuesScope>('assigned');
  const { initial: displayPrefs, save: saveDisplayPrefs } = useListDisplayPrefs('my-issues');
  const [listGroupBy, setListGroupBy] = useState<ListGroupBy>(displayPrefs.listGroupBy);
  const [orderBy, setOrderBy] = useState<ListOrderBy>(displayPrefs.orderBy);
  const [completed, setCompleted] = useState<CompletedIssuesMode>(displayPrefs.completed);

  // ── Store-derived values ─────────────────────────────────────────────────

  const currentUser = userStore.currentUser;

  // "My issues" is three different questions — what am I on the hook for, what
  // did I file, and what am I following. The first two are derivable from the
  // local pool. Subscriptions are user-local and never synced, so the third asks
  // the server for the id set (re-fetched each time the tab is opened, so a
  // subscribe made elsewhere shows up) and resolves the rows from the pool.
  const {
    data: subscribedIds,
    error: subscribedError,
    loading: subscribedLoading,
    refetch: refetchSubscribed,
  } = useRetryableFetch<string[] | null>(
    async () =>
      scope === 'subscribed'
        ? await gqlQuery<string[]>(SUBSCRIBED_IDS_QUERY, {}, 'notificationSubscribedIssueIds')
        : null,
    [scope],
    null,
  );
  const subscribedSet = useMemo(() => new Set(subscribedIds ?? []), [subscribedIds]);

  // Two variants because the "Completed issues" preference only has a control
  // in list mode: the board and timeline must show everything, or issues would
  // vanish with no way to bring them back.
  const buildMine = (completedMode: CompletedIssuesMode): IssueDetail[] => {
    if (!currentUser) {
      return [];
    }
    const mine = (i: { assigneeId?: string | null; creatorId?: string | null; id: string }) => {
      if (scope === 'subscribed') {
        return subscribedSet.has(i.id);
      }
      return scope === 'created' ? i.creatorId === currentUser.id : i.assigneeId === currentUser.id;
    };
    return filterCompletedIssues(
      Array.from(issueStore.pool.values()).filter(i => mine(i) && !i.trashed && !i.archivedAt),
      completedMode,
      stateIdsOfType(workflowStateStore.all, ['completed', 'canceled']),
    )
      .map(i => toIssueDetail(i, labelStore))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  };
  const mineDeps = [
    issueStore.pool.size,
    userStore.pool.size,
    workflowStateStore.pool.size,
    currentUser,
    issueStore,
    labelStore,
    scope,
    subscribedSet,
    workflowStateStore,
  ];
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const mineAll = useMemo(() => buildMine('all'), mineDeps);
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const mineListMode = useMemo(() => buildMine(completed), [...mineDeps, completed]);

  // Every active state across all teams — filter options and the timeline only.
  // Names shared by several teams get a team suffix so the filter doesn't offer
  // two indistinguishable "Todo" rows. Grouping and status pickers must NOT use
  // this union: states belong to a team, so they get one section per team below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const states = useMemo(
    () => disambiguateStateNames(workflowStateStore.all, id => teamStore.findById(id)?.key),
    [workflowStateStore.pool.size, teamStore.pool.size],
  );

  const lookups = useFilterLookups();
  // Filter, sort and group one of the two sources above.
  const derive = (source: IssueDetail[]) => {
    const filtered = applySorting(
      applyFilters(source, filterSet, undefined, buildFilterContext(workflowStateStore.all)),
      orderByToSort(orderBy),
    );
    const groups = groupIssuesByTeam(
      filtered,
      teamStore.all.map(team => team.id),
    );
    // Keyboard navigation (j/k) walks the order the sections are drawn in.
    return { groups, issues: groups.flatMap(group => group.issues) };
  };
  const sourceFor = (mode: string) => (mode === 'list' ? mineListMode : mineAll);

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
    handleArchiveMany,
    handleDeleteMany,
    handleOpen,
    issues,
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
    initialBoardGroupBy: displayPrefs.boardGroupBy,
    initialSwimlaneBy: displayPrefs.swimlaneBy,
    initialViewMode: displayPrefs.viewMode,
    issues: mode => derive(sourceFor(mode)).issues,
  });

  const { groups: teamGroups } = derive(sourceFor(viewMode));
  const multiTeam = teamGroups.length > 1;
  // One section per team, each with only that team's workflow states. An empty
  // list still gets one (stateless) section so the empty state renders.
  const sections = (teamGroups.length > 0 ? teamGroups : [{ issues, teamId: '' }]).map(group => ({
    ...group,
    states: workflowStateStore.findByTeamId(group.teamId),
  }));

  useEffect(() => {
    saveDisplayPrefs({
      ...displayPrefs,
      boardGroupBy,
      completed,
      listGroupBy,
      orderBy,
      swimlaneBy,
      viewMode,
    });
  }, [
    boardGroupBy,
    completed,
    displayPrefs,
    listGroupBy,
    orderBy,
    saveDisplayPrefs,
    swimlaneBy,
    viewMode,
  ]);

  // On the Assigned tab every row's assignee is the viewer, so that column (and
  // grouping by it) would be the same face / one section — noise, not signal.
  const isColumnVisible = (key: string) => !(scope === 'assigned' && key === 'assignee');
  const groupOptions = ALL_GROUP_OPTIONS.filter(g => scope !== 'assigned' || g !== 'assignee');
  const effectiveGroupBy: ListGroupBy =
    scope === 'assigned' && listGroupBy === 'assignee' ? 'status' : listGroupBy;

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
            {viewMode === 'list' && (
              <ListDisplayControls
                completed={completed}
                groupBy={effectiveGroupBy}
                groupOptions={groupOptions}
                onCompleted={setCompleted}
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
        title={t('issues.myIssues')}
      />

      <Toolbar className="justify-between">
        <SegmentedControl
          onChange={setScope}
          options={[
            { label: t('issues.scope.assigned'), value: 'assigned' },
            { label: t('issues.scope.created'), value: 'created' },
            { label: t('issues.scope.subscribed'), value: 'subscribed' },
          ]}
          value={scope}
        />
        <FilterBuilder
          cycles={lookups.cycles}
          estimateScaleMixed={lookups.estimateScaleMixed}
          filterSet={filterSet}
          labels={labels}
          onChange={setFilterSet}
          projects={lookups.projects}
          states={states}
          users={users}
        />
      </Toolbar>

      {/* Issue list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {scope === 'subscribed' && subscribedError ? (
          // A failed lookup must not read as "you follow nothing".
          <InlineRetry
            className="px-4"
            message={t('issues.subscribedLoadFailed')}
            onRetry={() => refetchSubscribed()}
          />
        ) : scope === 'subscribed' && subscribedLoading ? (
          <IssueListSkeleton />
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
          sections.map(section => (
            <section key={section.teamId}>
              {multiTeam && (
                <div className="border-b border-border bg-surface-sunken px-4 py-1.5">
                  <SectionHeader
                    as="h2"
                    title={teamStore.findById(section.teamId)?.name ?? section.teamId}
                  />
                </div>
              )}
              {viewMode === 'list' ? (
                <IssueListView
                  cycles={lookups.cycles}
                  groupBy={effectiveGroupBy}
                  hasActiveFilters={filterSet.conditions.length > 0}
                  isColumnVisible={isColumnVisible}
                  issues={section.issues}
                  labels={labels}
                  onArchive={handleArchive}
                  onArchiveMany={handleArchiveMany}
                  onBulkUpdate={handleBulkUpdate}
                  onDelete={requestDelete}
                  onDeleteMany={handleDeleteMany}
                  onOpen={handleOpen}
                  onPropertyClosed={() => setOpenProperty(null)}
                  onSelect={setSelectedId}
                  onUpdate={handleUpdate}
                  openProperty={openProperty}
                  projects={lookups.projects}
                  selectedId={selectedId}
                  states={section.states}
                  teamId={section.teamId}
                  users={users}
                />
              ) : (
                <BoardView
                  groupBy={boardGroupBy}
                  issues={section.issues}
                  labels={labels}
                  onOpen={handleOpen}
                  onSelect={setSelectedId}
                  onUpdate={handleUpdate}
                  selectedId={selectedId}
                  states={section.states}
                  swimlaneBy={swimlaneBy}
                  users={users}
                />
              )}
            </section>
          ))
        )}
      </div>
      {/* Detail panel */}
      <LazyIssueDetailPanel
        issue={detailIssue}
        labels={labels}
        onClose={closeDetail}
        onUpdate={handleUpdate}
        states={workflowStateStore.findByTeamId(detailIssue?.teamId ?? '')}
        users={users}
      />

      {/* Delete confirmation (context menu) */}
      <ConfirmDialog {...deleteDialogProps} />
    </div>
  );
});

export default MyIssuesPage;
