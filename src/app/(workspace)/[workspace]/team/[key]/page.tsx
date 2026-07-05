'use client';

import { Bookmark, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { type BoardGroupBy, type BoardSwimlaneBy, BoardView } from '@/components/issues/board-view';
import { ColumnPicker } from '@/components/issues/column-picker';
import { CsvExportButton } from '@/components/issues/csv-export-button';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView } from '@/components/issues/issue-list-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { type ViewMode, ViewToggle } from '@/components/issues/view-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { type SaveViewInput, SaveViewModal } from '@/components/views/save-view-modal';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useRecentItems } from '@/hooks/use-recent-items';
import { useTranslations } from '@/hooks/use-translations';
import { useVisibleColumns } from '@/hooks/use-visible-columns';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
import { applyFilters, createEmptyFilterSet, type FilterSet } from '@/lib/filter-engine';
import { gql } from '@/lib/graphql';
import {
  ISSUE_ARCHIVE_MUTATION,
  ISSUE_UNARCHIVE_MUTATION,
  ISSUES_BULK_UPDATE_MUTATION,
} from '@/lib/graphql-queries';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { buildIssueHref } from '@/lib/issue-nav';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
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

const ISSUE_DELETE_MUTATION = `
  mutation IssueDelete($id: ID!) {
    issueDelete(id: $id) {
      success
      lastSyncId
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
  const router = useRouter();
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

  // One queue per component mount — unmounting the page cleans up the reference
  const txQueue = useMemo(() => new TransactionQueue(), []);

  // UI state (local to this page)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  // Which property popover to force-open on the selected row (keyboard shortcut)
  const [openProperty, setOpenProperty] = useState<OpenProperty>(null);
  // View mode (list vs board), board group-by, and swimlane
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [boardGroupBy, setBoardGroupBy] = useState<BoardGroupBy>('status');
  const [swimlaneBy, setSwimlaneBy] = useState<BoardSwimlaneBy>('none');
  // Filters
  const [filterSet, setFilterSet] = useState<FilterSet>(createEmptyFilterSet());

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
      .map(i => ({
        ...i,
        dueDate: i.dueDate ?? null,
        labels: (i.labelIds ?? [])
          .map(id => labelStore.findById(id))
          .filter((l): l is DBIssueLabel => l !== null)
          .map(l => ({ color: l.color, id: l.id, name: l.name })),
      }))
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
  const issues = applyFilters(
    allIssues,
    filterSet,
    (issueId, definitionId) => customFieldStore.findValue(issueId, definitionId)?.value ?? null,
  );

  const users: IssueUser[] = toIssueUsers(userStore.all);

  const labels: IssueLabel[] = toIssueLabels(labelStore.all);

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  const detailIssue: IssueDetail | null = (() => {
    if (!detailIssueId) {
      return null;
    }
    const raw = issueStore.findById(detailIssueId);
    if (!raw) {
      return null;
    }
    const issueLabels = (raw.labelIds ?? [])
      .map(id => labelStore.findById(id))
      .filter((l): l is DBIssueLabel => l !== null)
      .map(l => ({ color: l.color, id: l.id, name: l.name }));
    return { ...raw, dueDate: raw.dueDate ?? null, labels: issueLabels };
  })();

  // ── Mutations ─────────────────────────────────────────────────────────────

  const handleUpdate = useIssueUpdate();

  const handleBulkUpdate = useCallback(
    (ids: string[], patch: Record<string, unknown>) => {
      const snapshots = ids.map(id => ({ id, snapshot: issueStore.findById(id) }));
      for (const id of ids) {
        issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);
      }
      txQueue.enqueue(
        ISSUES_BULK_UPDATE_MUTATION,
        { ids, input: patch },
        {
          onError: err => {
            toast.error(err instanceof Error ? err.message : t('issues.bulkUpdateFailed'));
            for (const { id, snapshot } of snapshots) {
              if (snapshot) {
                issueStore.optimisticUpdate(id, snapshot);
              }
            }
          },
          onSuccess: data => {
            const updated =
              (data as { issuesBulkUpdate?: { issues?: DBIssue[] } })?.issuesBulkUpdate?.issues ??
              [];
            for (const issue of updated) {
              issueStore.applySyncAction('U', issue.id, issue);
            }
          },
        },
      );
    },
    [issueStore, txQueue, t],
  );

  const handleUnarchive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: null });
      txQueue.enqueue(
        ISSUE_UNARCHIVE_MUTATION,
        { id },
        {
          onError: err => {
            toast.error(err instanceof Error ? err.message : t('issues.restoreFailed'));
            issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
          },
        },
      );
    },
    [issueStore, txQueue, t],
  );

  const handleArchive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      const undoToastId = toast.undo(t('issues.archivedToast'), t('common.undo'), () =>
        handleUnarchive(id),
      );
      txQueue.enqueue(
        ISSUE_ARCHIVE_MUTATION,
        { id },
        {
          onError: err => {
            // The archive never happened server-side: retire the stale Undo
            // affordance before surfacing the failure and rolling back.
            toast.dismiss(undoToastId);
            toast.error(err instanceof Error ? err.message : t('issues.archiveFailed'));
            issueStore.optimisticUpdate(id, { archivedAt: null });
          },
          onSuccess: () => {
            // Server delta sync will confirm the archive
          },
        },
      );
      if (selectedId === id) {
        setSelectedId(null);
      }
    },
    [issueStore, txQueue, selectedId, t, handleUnarchive],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const snapshot = issueStore.findById(id);
      issueStore.pool.delete(id);
      txQueue.enqueue(
        ISSUE_DELETE_MUTATION,
        { id },
        {
          onError: err => {
            toast.error(err instanceof Error ? err.message : t('issues.deleteFailed'));
            // Restore the issue optimistically if the server rejects the delete
            if (snapshot) {
              issueStore.applySyncAction('I', id, snapshot);
            }
          },
        },
      );
      if (selectedId === id) {
        setSelectedId(null);
      }
    },
    [issueStore, txQueue, selectedId, t],
  );

  // Delete is irreversible (no restore mutation), so it goes through a
  // confirmation dialog instead of firing straight from the context menu.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; identifier: string } | null>(
    null,
  );
  const requestDelete = useCallback(
    (id: string) => {
      const issue = issueStore.findById(id);
      setPendingDelete({ id, identifier: issue?.identifier ?? '' });
    },
    [issueStore],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const selectedIndex = issues.findIndex(i => i.id === selectedId);
  const hasSelection = selectedId !== null;

  // C (create issue) is registered globally in WorkspaceClient and opens the
  // shared GlobalCreateIssueModal; the New-issue button below uses it too.

  // J / K — navigate list
  useHotkeys(
    'j',
    () => {
      const next = Math.min(selectedIndex + 1, issues.length - 1);
      setSelectedId(issues[next]?.id ?? null);
    },
    {},
    [selectedIndex, issues],
  );
  useHotkeys(
    'k',
    () => {
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedId(issues[prev]?.id ?? null);
    },
    {},
    [selectedIndex, issues],
  );

  // Enter — open detail
  useHotkeys(
    'enter',
    () => {
      if (selectedId) {
        setDetailIssueId(selectedId);
      }
    },
    {},
    [selectedId],
  );

  // Escape — clear selection / close detail
  useHotkeys(
    'escape',
    () => {
      if (detailIssueId) {
        setDetailIssueId(null);
        router.replace(`/${workspace}/team/${teamKey}`, { scroll: false });
      } else {
        setSelectedId(null);
      }
    },
    {},
    [detailIssueId, workspace, teamKey],
  );

  // X — toggle selection checkbox
  useHotkeys(
    'x',
    () => {
      if (selectedId) {
        setSelectedId(prev => (prev === selectedId ? null : selectedId));
      }
    },
    {},
    [selectedId],
  );

  // Issue context shortcuts — only active when an issue is selected
  useHotkeys('s', () => setOpenProperty('status'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('a', () => setOpenProperty('assignee'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('p', () => setOpenProperty('priority'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('l', () => setOpenProperty('label'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('d', () => setOpenProperty('dueDate'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('shift+p', () => setOpenProperty('project'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys('q', () => setOpenProperty('cycle'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('shift+e', () => setOpenProperty('estimate'), { enabled: hasSelection }, [
    hasSelection,
  ]);

  // Backspace / Delete — archive selected issue
  useHotkeys(
    'backspace',
    () => {
      if (selectedId) {
        handleArchive(selectedId);
      }
    },
    { enabled: hasSelection },
    [selectedId, handleArchive, hasSelection],
  );
  useHotkeys(
    'delete',
    () => {
      if (selectedId) {
        handleArchive(selectedId);
      }
    },
    { enabled: hasSelection },
    [selectedId, handleArchive, hasSelection],
  );

  // Alt+1 — list view, Alt+2 — board view, Alt+3 — timeline view
  useHotkeys('alt+1', () => setViewMode('list'), {}, []);
  useHotkeys('alt+2', () => setViewMode('board'), {}, []);
  useHotkeys('alt+3', () => setViewMode('timeline'), {}, []);

  // G→I / G→N navigation chords are registered globally in WorkspaceClient.

  // ── Open issue and track as recent ────────────────────────────────────────

  const handleOpen = useCallback(
    (id: string) => {
      setDetailIssueId(id);
      const href = buildIssueHref(workspace, id, {
        label: team?.name ?? teamKey,
        path: `/${workspace}/team/${teamKey}`,
      });
      router.replace(href, { scroll: false });
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
    [workspace, teamKey, team?.name, issueStore, teamStore, addRecent, router],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {t('common.loading')}
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        {t('issues.failedToLoad')}
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        {t('issues.teamNotFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-foreground">
          {t('issues.teamIssuesTitle', { team: team.displayName ?? team.name })}
        </h1>
        <div className="flex items-center gap-2">
          {viewMode === 'board' && (
            <>
              <select
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                onChange={e => setBoardGroupBy(e.target.value as BoardGroupBy)}
                value={boardGroupBy}
              >
                <option value="status">{t('issues.groupByStatus')}</option>
                <option value="assignee">{t('issues.groupByAssignee')}</option>
                <option value="priority">{t('issues.groupByPriority')}</option>
              </select>
              <select
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                onChange={e => setSwimlaneBy(e.target.value as BoardSwimlaneBy)}
                value={swimlaneBy}
              >
                <option value="none">{t('issues.noSwimlanes')}</option>
                <option value="assignee">{t('issues.swimlaneByAssignee')}</option>
                <option value="priority">{t('issues.swimlaneByPriority')}</option>
              </select>
            </>
          )}
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Link
            className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            href={`/${workspace}/team/${teamKey}/settings`}
            title={t('issues.teamSettings')}
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90"
            onClick={() => uiStore.openCreateIssueModal()}
            type="button"
          >
            {t('issues.newIssue')}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
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
              stem={`team-${team?.key ?? 'issues'}-issues`}
              users={users}
            />
            <ColumnPicker
              customFields={customFieldDefs}
              isVisible={isColumnVisible}
              onToggle={toggleColumn}
            />
            <button
              aria-label={t('issues.saveView')}
              className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              onClick={() => setSaveViewOpen(true)}
              title={t('issues.saveCurrentFiltersAsView')}
              type="button"
            >
              <Bookmark className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Issue list / board / timeline */}
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
        onClose={() => {
          setDetailIssueId(null);
          router.replace(`/${workspace}/team/${teamKey}`, { scroll: false });
        }}
        onUpdate={handleUpdate}
        states={states}
        users={users}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        message={t('issues.deleteConfirmBody', { identifier: pendingDelete?.identifier ?? '' })}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            handleDelete(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
        open={pendingDelete !== null}
        title={t('issues.deleteConfirmTitle')}
      />

      {/* Save current filters as a custom view */}
      <SaveViewModal
        initialFilters={filterSet as unknown as object}
        initialGroupBy={viewMode === 'board' ? boardGroupBy : undefined}
        initialLayout={viewMode}
        onClose={() => setSaveViewOpen(false)}
        onSubmit={async (input: SaveViewInput) => {
          const res = await gql(CUSTOM_VIEW_CREATE_MUTATION, {
            input: { ...input, teamId },
          });
          if (res.errors?.length) {
            throw new Error((res.errors[0] as { message: string }).message);
          }
          toast.success(t('issues.viewSaved'));
        }}
        open={saveViewOpen}
        teamId={teamId ?? undefined}
      />
    </div>
  );
});

export default TeamIssuesPage;
