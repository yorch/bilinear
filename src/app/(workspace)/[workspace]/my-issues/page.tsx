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
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
import { applyFilters, createEmptyFilterSet, type FilterSet } from '@/lib/filter-engine';
import { ISSUES_BULK_UPDATE_MUTATION } from '@/lib/graphql-queries';
import { toIssueLabels, toIssueUsers } from '@/lib/issue-mappers';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail, IssueLabel, IssueUser } from '@/types/issues';

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

const MyIssuesPage = observer(function MyIssuesPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const router = useRouter();
  const t = useTranslations();
  const { issueStore, userStore, workflowStateStore, labelStore, syncStore } = useStore();

  useDocumentTitle(t('nav.myIssues'));

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
  const users: IssueUser[] = useMemo(() => toIssueUsers(userStore.all), [userStore.pool.size]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the MobX reactive trigger
  const labels: IssueLabel[] = useMemo(() => toIssueLabels(labelStore.all), [labelStore.pool.size]);

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-foreground">{t('issues.myIssues')}</h1>
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
