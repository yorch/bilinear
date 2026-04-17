'use client';

import { Settings } from 'lucide-react';
import { runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  type BoardGroupBy,
  type BoardSwimlaneBy,
  BoardView,
} from '@/components/issues/board-view';
import { ColumnPicker } from '@/components/issues/column-picker';
import { CreateIssueModal } from '@/components/issues/create-issue-modal';
import { CsvExportButton } from '@/components/issues/csv-export-button';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView } from '@/components/issues/issue-list-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { type ViewMode, ViewToggle } from '@/components/issues/view-toggle';
import { useChord, useHotkeys } from '@/hooks/use-hotkeys';
import { useRecentItems } from '@/hooks/use-recent-items';
import { useVisibleColumns } from '@/hooks/use-visible-columns';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
import {
  applyFilters,
  createEmptyFilterSet,
  type FilterSet,
} from '@/lib/filter-engine';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

// ---------------------------------------------------------------------------
// GraphQL mutations (queries replaced by MobX store reads)
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id identifier number title description priority estimate dueDate
  sortOrder prioritySortOrder trashed
  teamId organizationId stateId assigneeId creatorId parentId
  projectId cycleId branchName
  startedAt completedAt canceledAt archivedAt createdAt updatedAt
  labels { id name color }
`;

const ISSUE_CREATE_MUTATION = `
  mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      lastSyncId
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

const ISSUE_UPDATE_MUTATION = `
  mutation IssueUpdate($id: ID!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      lastSyncId
      issue { ${ISSUE_FIELDS} }
    }
  }
`;

const ISSUE_ARCHIVE_MUTATION = `
  mutation IssueArchive($id: ID!) {
    issueArchive(id: $id) {
      success
      lastSyncId
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
  } = useStore();

  // One queue per component mount — unmounting the page cleans up the reference
  const txQueue = useMemo(() => new TransactionQueue(), []);

  // UI state (local to this page)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: MobX observables — size changes when definitions mutate, which is the signal we want to re-run on
  const customFieldDefs = useMemo(
    () => (teamId ? customFieldStore.findDefinitionsByTeamId(teamId) : []),
    [teamId, customFieldStore.definitions.size],
  );

  // Column visibility is per-team so switching teams gives a fresh pick.
  const { isVisible: isColumnVisible, toggle: toggleColumn } =
    useVisibleColumns(teamId ?? 'no-team');

  // biome-ignore lint/correctness/useExhaustiveDependencies: MobX observables — values.size change triggers re-filter on value updates
  const issues = useMemo(
    () =>
      applyFilters(allIssues, filterSet, (issueId, definitionId) => {
        return customFieldStore.findValue(issueId, definitionId)?.value ?? null;
      }),
    [allIssues, filterSet, customFieldStore.values.size],
  );

  const users: IssueUser[] = userStore.all.map(u => ({
    avatarBackgroundColor: u.avatarBgColor,
    avatarUrl: u.avatarUrl ?? null,
    displayName: u.displayName,
    id: u.id,
    initials: u.initials,
  }));

  const labels: IssueLabel[] = labelStore.all.map(l => ({
    color: l.color,
    id: l.id,
    name: l.name,
  }));

  const isLoading =
    syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
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

  const handleUpdate = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const snapshot = issueStore.findById(id);
      issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);

      txQueue.enqueue(
        ISSUE_UPDATE_MUTATION,
        { id, input: patch },
        {
          onError: () => {
            if (snapshot) {
              issueStore.optimisticUpdate(id, snapshot);
            }
          },
          onSuccess: data => {
            const updated = (data as { issueUpdate?: { issue?: DBIssue } })
              ?.issueUpdate?.issue;
            if (updated) {
              issueStore.applySyncAction('U', id, updated);
            }
          },
        },
      );
    },
    [issueStore, txQueue],
  );

  const handleCreate = useCallback(
    async (input: {
      title: string;
      description?: string;
      stateId?: string;
      assigneeId?: string;
      priority: number;
      labelIds: string[];
      dueDate?: string | null;
    }) => {
      if (!teamId || !team) {
        return;
      }

      // Optimistically add the issue so it appears immediately (offline support).
      const tempId = `temp-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const effectiveStateId =
        input.stateId ??
        states.find(s => s.type === 'backlog')?.id ??
        states[0]?.id ??
        '';
      issueStore.applySyncAction('I', tempId, {
        archivedAt: null,
        assigneeId: input.assigneeId ?? null,
        branchName: null,
        canceledAt: null,
        completedAt: null,
        createdAt: now,
        creatorId: null,
        cycleId: null,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
        estimate: null,
        id: tempId,
        identifier: `${team.key}-…`,
        labelIds: input.labelIds,
        number: 0,
        organizationId: team.organizationId,
        parentId: null,
        priority: input.priority,
        prioritySortOrder: 0,
        projectId: null,
        sortOrder: 0,
        startedAt: null,
        stateId: effectiveStateId,
        teamId,
        title: input.title,
        trashed: false,
        updatedAt: now,
      } as DBIssue);

      txQueue.enqueue(
        ISSUE_CREATE_MUTATION,
        { input: { ...input, stateId: effectiveStateId || undefined, teamId } },
        {
          onError: err => {
            console.error('[TeamPage] issueCreate failed:', err);
            runInAction(() => {
              issueStore.pool.delete(tempId);
            });
          },
          onSuccess: data => {
            const created = (data as { issueCreate?: { issue?: DBIssue } })
              ?.issueCreate?.issue;
            runInAction(() => {
              issueStore.pool.delete(tempId);
              if (created) {
                issueStore.applySyncAction('I', created.id, created);
              }
            });
          },
        },
      );
    },
    [teamId, team, issueStore, txQueue, states],
  );

  const handleArchive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      txQueue.enqueue(
        ISSUE_ARCHIVE_MUTATION,
        { id },
        {
          onError: () => {
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
    [issueStore, txQueue, selectedId],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const snapshot = issueStore.findById(id);
      issueStore.pool.delete(id);
      txQueue.enqueue(
        ISSUE_DELETE_MUTATION,
        { id },
        {
          onError: () => {
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
    [issueStore, txQueue, selectedId],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const selectedIndex = issues.findIndex(i => i.id === selectedId);
  const hasSelection = selectedId !== null;

  // C — create issue
  useHotkeys('c', () => setCreateOpen(true), {}, []);

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
  useHotkeys('s', () => setOpenProperty('status'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys(
    'a',
    () => setOpenProperty('assignee'),
    { enabled: hasSelection },
    [hasSelection],
  );
  useHotkeys(
    'p',
    () => setOpenProperty('priority'),
    { enabled: hasSelection },
    [hasSelection],
  );
  useHotkeys('l', () => setOpenProperty('label'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys('d', () => setOpenProperty('dueDate'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys(
    'shift+p',
    () => setOpenProperty('project'),
    { enabled: hasSelection },
    [hasSelection],
  );
  useHotkeys('q', () => setOpenProperty('cycle'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys(
    'shift+e',
    () => setOpenProperty('estimate'),
    { enabled: hasSelection },
    [hasSelection],
  );

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

  // Alt+1 — list view, Alt+2 — board view
  useHotkeys('alt+1', () => setViewMode('list'), {}, []);
  useHotkeys('alt+2', () => setViewMode('board'), {}, []);

  // G then I — go to my issues (placeholder navigation)
  useChord('g', 'i', () => router.push(`/${workspace}/my-issues`), [workspace]);
  // G then N — go to inbox (placeholder navigation)
  useChord('g', 'n', () => router.push(`/${workspace}/inbox`), [workspace]);

  // ── Open issue and track as recent ────────────────────────────────────────

  const handleOpen = useCallback(
    (id: string) => {
      setDetailIssueId(id);
      router.replace(`/${workspace}/issue/${id}`, { scroll: false });
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
    [workspace, issueStore, teamStore, addRecent, router],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading…
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        Failed to load data. Please refresh.
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Team not found.
      </div>
    );
  }

  const defaultStateId =
    states.find(s => s.type === 'backlog')?.id ?? states[0]?.id;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {team.displayName ?? team.name} — Issues
        </h1>
        <div className="flex items-center gap-2">
          {viewMode === 'board' && (
            <>
              <select
                value={boardGroupBy}
                onChange={e => setBoardGroupBy(e.target.value as BoardGroupBy)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="status">Group by status</option>
                <option value="assignee">Group by assignee</option>
                <option value="priority">Group by priority</option>
              </select>
              <select
                value={swimlaneBy}
                onChange={e => setSwimlaneBy(e.target.value as BoardSwimlaneBy)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <option value="none">No swimlanes</option>
                <option value="assignee">Swimlane by assignee</option>
                <option value="priority">Swimlane by priority</option>
              </select>
            </>
          )}
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <Link
            href={`/${workspace}/team/${teamKey}/settings`}
            title="Team settings"
            className="flex items-center justify-center rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            New issue
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <FilterBuilder
          filterSet={filterSet}
          onChange={setFilterSet}
          states={states}
          users={users}
          labels={labels}
          customFields={customFieldDefs}
        />
        {viewMode === 'list' && (
          <div className="flex items-center gap-1">
            <CsvExportButton
              issues={issues}
              states={states}
              users={users}
              projectsById={
                new Map(
                  Array.from(projectStore.pool.values()).map(p => [
                    p.id,
                    { name: p.name },
                  ]),
                )
              }
              cyclesById={
                new Map(
                  Array.from(cycleStore.pool.values()).map(c => [
                    c.id,
                    { name: c.name ?? null, number: c.number },
                  ]),
                )
              }
              customFields={customFieldDefs}
              getCustomFieldValue={(issueId, definitionId) =>
                customFieldStore.findValue(issueId, definitionId)?.value ?? null
              }
              stem={`team-${team?.key ?? 'issues'}-issues`}
            />
            <ColumnPicker
              isVisible={isColumnVisible}
              onToggle={toggleColumn}
              customFields={customFieldDefs}
            />
          </div>
        )}
      </div>

      {/* Issue list / board */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
            issues={issues}
            states={states}
            users={users}
            labels={labels}
            teamId={teamId ?? undefined}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={handleOpen}
            onUpdate={handleUpdate}
            onArchive={handleArchive}
            onDelete={handleDelete}
            openProperty={openProperty}
            onPropertyClosed={() => setOpenProperty(null)}
            isColumnVisible={isColumnVisible}
            customFields={customFieldDefs}
            getCustomFieldValue={(issueId, definitionId) =>
              customFieldStore.findValue(issueId, definitionId)?.value ?? null
            }
          />
        ) : (
          <BoardView
            issues={issues}
            states={states}
            users={users}
            labels={labels}
            groupBy={boardGroupBy}
            swimlaneBy={swimlaneBy}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={handleOpen}
            onUpdate={handleUpdate}
          />
        )}
      </div>

      {/* Detail panel (lazy-loaded) */}
      <LazyIssueDetailPanel
        issue={detailIssue}
        states={states}
        users={users}
        labels={labels}
        onClose={() => {
          setDetailIssueId(null);
          router.replace(`/${workspace}/team/${teamKey}`, { scroll: false });
        }}
        onUpdate={handleUpdate}
      />

      {/* Create modal */}
      <CreateIssueModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
        states={states}
        users={users}
        labels={labels}
        defaultStateId={defaultStateId}
        teamId={teamId ?? undefined}
      />
    </div>
  );
});

export default TeamIssuesPage;
