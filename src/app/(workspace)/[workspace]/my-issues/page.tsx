'use client';

import { observer } from 'mobx-react-lite';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { type BoardGroupBy, type BoardSwimlaneBy, BoardView } from '@/components/issues/board-view';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { IssueListView } from '@/components/issues/issue-list-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import { LazyIssueDetailPanel } from '@/components/issues/lazy-issue-detail-panel';
import { type ViewMode, ViewToggle } from '@/components/issues/view-toggle';
import { type GanttItem, GanttView } from '@/components/roadmap/gantt-view';
import { useHotkeys } from '@/hooks/use-hotkeys';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
import { applyFilters, createEmptyFilterSet, type FilterSet } from '@/lib/filter-engine';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

// ---------------------------------------------------------------------------
// GraphQL mutation
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = `
  id identifier number title description priority estimate dueDate startDate
  sortOrder prioritySortOrder trashed
  teamId organizationId stateId assigneeId creatorId parentId
  projectId cycleId branchName
  startedAt completedAt canceledAt archivedAt createdAt updatedAt
  labels { id name color }
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

const ISSUES_BULK_UPDATE_MUTATION = `
  mutation IssuesBulkUpdate($ids: [ID!]!, $input: IssueUpdateInput!) {
    issuesBulkUpdate(ids: $ids, input: $input) {
      success
      lastSyncId
      issues { ${ISSUE_FIELDS} }
    }
  }
`;

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const MyIssuesPage = observer(function MyIssuesPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  const { issueStore, userStore, workflowStateStore, labelStore, syncStore } = useStore();

  const txQueue = useMemo(() => new TransactionQueue(), []);

  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<OpenProperty>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [boardGroupBy, setBoardGroupBy] = useState<BoardGroupBy>('status');
  const [swimlaneBy, setSwimlaneBy] = useState<BoardSwimlaneBy>('none');
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
      .map(i => ({
        ...i,
        dueDate: i.dueDate ?? null,
        labels: (i.labelIds ?? [])
          .map(id => labelStore.findById(id))
          .filter((l): l is DBIssueLabel => l !== null)
          .map(l => ({ color: l.color, id: l.id, name: l.name })),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [issueStore.pool.size, userStore.pool.size, currentUser, issueStore, labelStore]);

  // All active workflow states across all teams (for grouping + filter options).
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const states = useMemo(() => workflowStateStore.all, [workflowStateStore.pool.size]);

  const issues = applyFilters(allMyIssues, filterSet);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const users: IssueUser[] = useMemo(
    () =>
      userStore.all.map(u => ({
        avatarBackgroundColor: u.avatarBgColor,
        avatarUrl: u.avatarUrl ?? null,
        displayName: u.displayName,
        id: u.id,
        initials: u.initials,
      })),
    [userStore.pool.size],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const labels: IssueLabel[] = useMemo(
    () =>
      labelStore.all.map(l => ({
        color: l.color,
        id: l.id,
        name: l.name,
      })),
    [labelStore.pool.size],
  );

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';
  const hasError = syncStore.status === 'error';

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const detailIssue: IssueDetail | null = useMemo(() => {
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
  }, [detailIssueId, issueStore.pool.size, issueStore, labelStore]);

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
            const updated = (data as { issueUpdate?: { issue?: DBIssue } })?.issueUpdate?.issue;
            if (updated) {
              issueStore.applySyncAction('U', id, updated);
            }
          },
        },
      );
    },
    [issueStore, txQueue],
  );

  const handleBulkUpdate = useCallback(
    (ids: string[], patch: Record<string, unknown>) => {
      for (const id of ids) {
        issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);
      }
      txQueue.enqueue(
        ISSUES_BULK_UPDATE_MUTATION,
        { ids, input: patch },
        {
          onError: () => {},
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
    [issueStore, txQueue],
  );

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  const selectedIndex = issues.findIndex(i => i.id === selectedId);
  const hasSelection = selectedId !== null;

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

  useHotkeys(
    'escape',
    () => {
      if (detailIssueId) {
        setDetailIssueId(null);
        router.replace(`/${workspace}/my-issues`, { scroll: false });
      } else {
        setSelectedId(null);
      }
    },
    {},
    [detailIssueId, workspace],
  );

  useHotkeys('s', () => setOpenProperty('status'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('a', () => setOpenProperty('assignee'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('p', () => setOpenProperty('priority'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('l', () => setOpenProperty('label'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('d', () => setOpenProperty('dueDate'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('shift+e', () => setOpenProperty('estimate'), { enabled: hasSelection }, [
    hasSelection,
  ]);

  useHotkeys('alt+1', () => setViewMode('list'), {}, []);
  useHotkeys('alt+2', () => setViewMode('board'), {}, []);
  useHotkeys('alt+3', () => setViewMode('timeline'), {}, []);

  // ── Open issue ────────────────────────────────────────────────────────────

  const handleOpen = useCallback(
    (id: string) => {
      setDetailIssueId(id);
      router.replace(`/${workspace}/issue/${id}`, { scroll: false });
    },
    [workspace, router],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">Loading…</div>
    );
  }

  if (hasError) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-red-500">
        Failed to load data. Please refresh.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">My Issues</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {issues.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === 'board' && (
            <>
              <select
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                onChange={e => setBoardGroupBy(e.target.value as BoardGroupBy)}
                value={boardGroupBy}
              >
                <option value="status">Group by status</option>
                <option value="assignee">Group by assignee</option>
                <option value="priority">Group by priority</option>
              </select>
              <select
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                onChange={e => setSwimlaneBy(e.target.value as BoardSwimlaneBy)}
                value={swimlaneBy}
              >
                <option value="none">No swimlanes</option>
                <option value="assignee">Swimlane by assignee</option>
                <option value="priority">Swimlane by priority</option>
              </select>
            </>
          )}
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <FilterBuilder
          filterSet={filterSet}
          labels={labels}
          onChange={setFilterSet}
          states={states}
          users={users}
        />
      </div>

      {/* Issue list / board / timeline */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
          <IssueListView
            issues={issues}
            labels={labels}
            onBulkUpdate={handleBulkUpdate}
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
            emptyMessage="No issues with start or due dates. Add dates to issues to populate the timeline."
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
        onClose={() => {
          setDetailIssueId(null);
          router.replace(`/${workspace}/my-issues`, { scroll: false });
        }}
        onUpdate={handleUpdate}
        states={states}
        users={users}
      />
    </div>
  );
});

export default MyIssuesPage;
