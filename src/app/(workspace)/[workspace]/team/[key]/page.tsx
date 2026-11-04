'use client';

import { Bookmark, Plus, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BoardControls } from '@/components/issues/board-controls';
import { BoardView } from '@/components/issues/board-view';
import { ColumnPicker } from '@/components/issues/column-picker';
import { CsvExportButton } from '@/components/issues/csv-export-button';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView, type ListGroupBy } from '@/components/issues/issue-list-view';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { ListDisplayControls } from '@/components/issues/list-display-controls';
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
import { useIssueListPage } from '@/hooks/use-issue-list-page';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useIssuesBulkUpdate } from '@/hooks/use-issues-bulk-update';
import { useRecentItems } from '@/hooks/use-recent-items';
import { useTranslations } from '@/hooks/use-translations';
import { useVisibleColumns } from '@/hooks/use-visible-columns';
import {
  applyFilters,
  applySorting,
  coerceFilterSet,
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

// ---------------------------------------------------------------------------
// GraphQL mutations
// ---------------------------------------------------------------------------

const CUSTOM_VIEW_CREATE_MUTATION = `
  mutation CustomViewCreate($input: CustomViewCreateInput!) {
    customViewCreate(input: $input) {
      success
      lastSyncId
      customView { id name }
    }
  }
`;

// ---------------------------------------------------------------------------
// Page component (observer so it re-renders on MobX store changes)
// ---------------------------------------------------------------------------

const TeamIssuesPage = observer(function TeamIssuesPage() {
  const { workspace, key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
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

  // UI state (local to this page)
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const router = useRouter();
  const [listGroupBy, setListGroupBy] = useState<ListGroupBy>('status');
  const [orderBy, setOrderBy] = useState<ListOrderBy>('manual');
  // Filters. Kept per team in sessionStorage so a reload or a trip into an
  // issue and back doesn't silently drop them (storage can be unavailable, so
  // every access is guarded and the page works without it).
  const filterStorageKey = `bilinear:team-filters:${teamKey}`;
  const [filterSet, setFilterSetState] = useState<FilterSet>(() => {
    try {
      const raw = window.sessionStorage.getItem(filterStorageKey);
      return raw ? coerceFilterSet(JSON.parse(raw)) : createEmptyFilterSet();
    } catch {
      return createEmptyFilterSet();
    }
  });
  const setFilterSet = (next: FilterSet) => {
    setFilterSetState(next);
    try {
      if (next.conditions.length === 0) {
        window.sessionStorage.removeItem(filterStorageKey);
      } else {
        window.sessionStorage.setItem(filterStorageKey, JSON.stringify(next));
      }
    } catch {
      // Storage blocked: filters just stay in memory.
    }
  };

  // Recent items tracking (for command palette) — scoped to this workspace
  const { addRecent } = useRecentItems(workspace);

  // ── Store-derived values ─────────────────────────────────────────────────

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  useDocumentTitle(team?.name);

  const rawStates = teamId ? workflowStateStore.findByTeamId(teamId) : [];
  const states = rawStates;

  const allIssues: IssueDetail[] = (() => {
    if (!teamId) {
      return [];
    }
    const statePositionMap = new Map(rawStates.map(s => [s.id, s.position]));
    return issueStore
      .findByTeamId(teamId)
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

  // Plain selector rather than useMemo. The previous `[..., definitions.size]`
  // dep ignored in-place mutations (rename, options change) — size is
  // unchanged, so the memo kept stale values. `observer()` tracks every
  // observable read inside this component, so the selector re-runs whenever
  // any field actually used (definition row, value) updates. The cost is a
  // map filter per render, which is negligible for the typical <50 fields.
  const customFieldDefs = teamId ? customFieldStore.findDefinitionsByTeamId(teamId) : [];

  // Column visibility is per-team so switching teams gives a fresh pick.
  const { isVisible: isColumnVisible, toggle: toggleColumn } = useVisibleColumns(
    teamId ?? 'no-team',
  );

  // Same rationale as `customFieldDefs`: stop memoizing on `.size`. Filters
  // depend on the actual field values, not their cardinality.
  const filtered = applyFilters(
    allIssues,
    filterSet,
    (issueId, definitionId) => customFieldStore.findValue(issueId, definitionId)?.value ?? null,
  );
  // "Manual" keeps the team's own order (workflow position, then drag order);
  // any other choice orders across the whole list before it is grouped.
  const issues = applySorting(filtered, orderByToSort(orderBy));

  const users: IssueUser[] = toIssueUsers(userStore.all);

  const labels: IssueLabel[] = toIssueLabels(labelStore.all);

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  // ── Selection, detail panel, view mode, keyboard shortcuts ──────────────────

  const {
    boardGroupBy,
    closeDetail,
    deleteDialogProps,
    detailIssue,
    handleArchive,
    handleArchiveMany,
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
    basePath: `/${workspace}/team/${teamKey}`,
    buildHref: id =>
      buildIssueHref(workspace, id, {
        label: team?.name ?? teamKey,
        path: `/${workspace}/team/${teamKey}`,
      }),
    issues,
    onOpen: id => {
      const issue = issueStore.findById(id);
      const issueTeam = issue ? teamStore.findById(issue.teamId) : null;
      if (issue && issueTeam) {
        addRecent({
          id: issue.id,
          identifier: issue.identifier,
          teamKey: issueTeam.key,
          title: issue.title,
        });
      }
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const handleUpdate = useIssueUpdate();
  const handleBulkUpdate = useIssuesBulkUpdate();

  // ── Team-specific keyboard shortcuts ─────────────────────────────────────
  // (j/k/enter/escape, common property pickers, and view-mode switches are
  // registered by useIssueListPage above)

  // C (create issue) is registered globally in WorkspaceClient and opens the
  // shared GlobalCreateIssueModal; the New-issue button below uses it too.

  // X (check the cursor row) and Escape (clear the checked set) live in
  // IssueListView, which owns the checked set.

  // Shift+P / Q project & cycle pickers and Backspace/Delete archive are
  // registered by useIssueListPage.

  // G→I / G→N navigation chords are registered globally in WorkspaceClient.

  // ── Render ────────────────────────────────────────────────────────────────

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
      {/* Page header */}
      <PageHeader
        actions={
          <>
            {viewMode === 'list' && (
              <ListDisplayControls
                groupBy={listGroupBy}
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
            <Link
              className={cn(
                'flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground',
                TOUCH_TARGET_SQUARE,
              )}
              href={`/${workspace}/team/${teamKey}/settings`}
              title={t('issues.teamSettings')}
            >
              <Settings className="h-4 w-4" />
            </Link>
            <Button onClick={() => uiStore.openCreateIssueModal()} size="sm" type="button">
              <Plus className="h-3.5 w-3.5" />
              {t('issues.newIssue')}
            </Button>
          </>
        }
        count={issues.length}
        title={t('issues.teamIssuesTitle', { team: team.displayName ?? team.name })}
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
        <div className="flex items-center gap-1">
          {viewMode === 'list' && (
            <>
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
                stem={`team-${team?.key ?? 'issues'}-issues`}
                users={users}
              />
              <ColumnPicker
                customFields={customFieldDefs}
                estimationType={team.issueEstimationType}
                isVisible={isColumnVisible}
                onToggle={toggleColumn}
              />
            </>
          )}
          {/* Saving captures the filters + layout, so it is offered in every layout. */}
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

      {/* Issue list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
            customFields={customFieldDefs}
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
            onBulkUpdate={handleBulkUpdate}
            onClearFilters={() => setFilterSet(createEmptyFilterSet())}
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

      {/* Delete confirmation */}
      <ConfirmDialog {...deleteDialogProps} />

      {/* Save current filters as a custom view */}
      <SaveViewModal
        initialFilters={filterSet}
        initialGroupBy={
          viewMode === 'board' ? boardGroupBy : viewMode === 'list' ? listGroupBy : undefined
        }
        initialLayout={viewMode}
        initialSort={orderByToSort(orderBy)}
        onClose={() => setSaveViewOpen(false)}
        onSubmit={async (input: SaveViewInput) => {
          const res = await gql(CUSTOM_VIEW_CREATE_MUTATION, {
            input: { ...input, teamId },
          });
          if (res.errors?.length) {
            throw new Error((res.errors[0] as { message: string }).message);
          }
          const created = (res.data as { customViewCreate?: { customView?: { id?: string } } })
            ?.customViewCreate?.customView;
          toast.success(t('issues.viewSaved'));
          // Land on the view that was just made, so the save is visible.
          if (created?.id) {
            router.push(`/${workspace}/team/${teamKey}/view/${created.id}`);
          }
        }}
        open={saveViewOpen}
        summary={t('issues.saveViewSummary', {
          count: filterSet.conditions.length,
          layout: t(`issues.layout${viewMode.charAt(0).toUpperCase()}${viewMode.slice(1)}`),
        })}
        teamId={teamId ?? undefined}
      />
    </div>
  );
});

export default TeamIssuesPage;
