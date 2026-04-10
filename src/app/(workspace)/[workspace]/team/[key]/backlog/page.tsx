'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { FilterBuilder } from '@/components/issues/filter-builder';
import { PriorityIcon } from '@/components/properties/priority-icon';
import { useHotkeys } from '@/hooks/use-hotkeys';
import type { DBIssue, DBIssueLabel } from '@/lib/db';
import {
  applyFilters,
  createEmptyFilterSet,
  type FilterSet,
} from '@/lib/filter-engine';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueLabel, IssueUser } from '@/types/issues';

// ─── Mutations ──────────────────────────────────────────────────────────────

const ISSUE_FIELDS = `
  id identifier number title description priority estimate dueDate
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

const ISSUE_ARCHIVE_MUTATION = `
  mutation IssueArchive($id: ID!) {
    issueArchive(id: $id) {
      success
      lastSyncId
    }
  }
`;

// ─── Priority labels ────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
};

// ─── Staleness indicator ────────────────────────────────────────────────────

function StalenessIndicator({ updatedAt }: { updatedAt: string }) {
  const daysSince = Math.floor(
    (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysSince < 7) {
    return null;
  }

  return (
    <span
      className={cn(
        'text-[10px] font-medium',
        daysSince >= 30
          ? 'text-red-500'
          : daysSince >= 14
            ? 'text-amber-500'
            : 'text-zinc-400 dark:text-zinc-500',
      )}
      title={`Last updated ${daysSince} days ago`}
    >
      {daysSince}d
    </span>
  );
}

// ─── Backlog row ────────────────────────────────────────────────────────────

interface BacklogIssue {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  stateId: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels: IssueLabel[];
  estimate?: number | null;
  updatedAt: string;
  createdAt: string;
}

interface BacklogRowProps {
  issue: BacklogIssue;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}

function BacklogRow({ issue, selected, onSelect, onUpdate }: BacklogRowProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-3 border-b border-zinc-100 px-4 py-2 text-left transition-colors dark:border-zinc-800',
        selected
          ? 'bg-indigo-50 dark:bg-indigo-950/30'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50',
      )}
      onClick={onSelect}
    >
      {/* Priority */}
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          const next = issue.priority >= 4 ? 0 : issue.priority + 1;
          onUpdate(issue.id, { priority: next });
        }}
        title={PRIORITY_LABELS[issue.priority]}
        className="flex-shrink-0"
      >
        <PriorityIcon priority={issue.priority} className="h-3.5 w-3.5" />
      </button>

      {/* Identifier */}
      <span className="w-16 flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
        {issue.identifier}
      </span>

      {/* Title */}
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
        {issue.title}
      </span>

      {/* Estimate — inline editable */}
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          const val = prompt('Estimate:', String(issue.estimate ?? ''));
          if (val !== null) {
            const num = val === '' ? null : parseFloat(val);
            onUpdate(issue.id, { estimate: num });
          }
        }}
        className="w-8 flex-shrink-0 text-center text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        title="Set estimate"
      >
        {issue.estimate ?? '—'}
      </button>

      {/* Labels */}
      <div className="flex flex-shrink-0 gap-0.5">
        {issue.labels.slice(0, 3).map(label => (
          <span
            key={label.id}
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: label.color }}
            title={label.name}
          />
        ))}
      </div>

      {/* Staleness */}
      <div className="w-8 flex-shrink-0 text-right">
        <StalenessIndicator updatedAt={issue.updatedAt} />
      </div>
    </button>
  );
}

// ─── Priority group ─────────────────────────────────────────────────────────

function PriorityGroup({
  priority,
  issues,
  selectedIds,
  onToggleSelect,
  onUpdate,
}: {
  priority: number;
  issues: BacklogIssue[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 text-left dark:border-zinc-800 dark:bg-zinc-900"
      >
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {PRIORITY_LABELS[priority] ?? `Priority ${priority}`}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {issues.length}
        </span>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed &&
        issues.map(issue => (
          <BacklogRow
            key={issue.id}
            issue={issue}
            selected={selectedIds.has(issue.id)}
            onSelect={() => onToggleSelect(issue.id)}
            onUpdate={onUpdate}
          />
        ))}
    </div>
  );
}

// ─── Main backlog page ──────────────────────────────────────────────────────

const BacklogPage = observer(function BacklogPage() {
  const { key: teamKey } = useParams<{
    workspace: string;
    key: string;
  }>();
  const {
    issueStore,
    teamStore,
    userStore,
    workflowStateStore,
    labelStore,
    syncStore,
  } = useStore();

  const txQueue = useMemo(() => new TransactionQueue(), []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterSet, setFilterSet] = useState<FilterSet>(createEmptyFilterSet());

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  const rawStates = teamId ? workflowStateStore.findByTeamId(teamId) : [];

  // Backlog shows only Backlog + Unstarted state categories
  const backlogStateIds = useMemo(() => {
    return new Set(
      rawStates
        .filter(s => s.type === 'backlog' || s.type === 'unstarted')
        .map(s => s.id),
    );
  }, [rawStates]);

  const allBacklogIssues = useMemo(() => {
    if (!teamId) {
      return [];
    }
    return issueStore
      .findByTeamId(teamId)
      .filter(i => backlogStateIds.has(i.stateId))
      .map(i => ({
        ...i,
        dueDate: i.dueDate ?? null,
        labels: (i.labelIds ?? [])
          .map(id => labelStore.findById(id))
          .filter((l): l is DBIssueLabel => l !== null)
          .map(l => ({ color: l.color, id: l.id, name: l.name })),
      }));
  }, [teamId, issueStore, labelStore, backlogStateIds]);

  const filteredIssues = useMemo(
    () => applyFilters(allBacklogIssues, filterSet),
    [allBacklogIssues, filterSet],
  );

  // Group by priority
  const priorityGroups = useMemo(() => {
    const groups = new Map<number, typeof filteredIssues>();
    for (const issue of filteredIssues) {
      const list = groups.get(issue.priority) ?? [];
      list.push(issue);
      groups.set(issue.priority, list);
    }
    // Sort by priority: urgent first, then high, medium, low, none
    return [1, 2, 3, 4, 0]
      .filter(p => groups.has(p))
      .map(p => ({ issues: groups.get(p) ?? [], priority: p }));
  }, [filteredIssues]);

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

  const states = rawStates;

  const isLoading =
    syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  // ── Mutations ───────────────────────────────────────────────────────────

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

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ── Bulk operations ─────────────────────────────────────────────────────

  const handleBulkSetPriority = useCallback(
    (priority: number) => {
      for (const id of selectedIds) {
        handleUpdate(id, { priority });
      }
      setSelectedIds(new Set());
    },
    [selectedIds, handleUpdate],
  );

  const handleBulkSetEstimate = useCallback(
    (estimate: number | null) => {
      for (const id of selectedIds) {
        handleUpdate(id, { estimate });
      }
      setSelectedIds(new Set());
    },
    [selectedIds, handleUpdate],
  );

  const handleBulkArchive = useCallback(() => {
    for (const id of selectedIds) {
      issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      txQueue.enqueue(
        ISSUE_ARCHIVE_MUTATION,
        { id },
        {
          onError: () => {
            issueStore.optimisticUpdate(id, { archivedAt: null });
          },
        },
      );
    }
    setSelectedIds(new Set());
  }, [selectedIds, issueStore, txQueue]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useHotkeys('escape', () => setSelectedIds(new Set()), {}, []);

  // ── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading...
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {team.displayName ?? team.name} — Backlog
        </h1>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {filteredIssues.length} issues
        </span>
      </div>

      {/* Filter bar */}
      <div className="border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <FilterBuilder
          filterSet={filterSet}
          onChange={setFilterSet}
          states={states}
          users={users}
          labels={labels}
        />
      </div>

      {/* Bulk actions toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 dark:border-indigo-800 dark:bg-indigo-950/30">
          <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
            {selectedIds.size} selected
          </span>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4].map(p => (
              <button
                key={p}
                type="button"
                onClick={() => handleBulkSetPriority(p)}
                className="rounded px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-indigo-100 dark:text-zinc-400 dark:hover:bg-indigo-900"
                title={`Set ${PRIORITY_LABELS[p]}`}
              >
                <PriorityIcon priority={p} className="h-3 w-3" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const val = prompt('Set estimate for selected issues:');
              if (val !== null) {
                const num = val === '' ? null : parseFloat(val);
                handleBulkSetEstimate(num);
              }
            }}
            className="rounded px-2 py-0.5 text-xs text-zinc-600 hover:bg-indigo-100 dark:text-zinc-400 dark:hover:bg-indigo-900"
          >
            Estimate
          </button>
          <button
            type="button"
            onClick={handleBulkArchive}
            className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            Archive
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            Clear
          </button>
        </div>
      )}

      {/* Backlog list */}
      <div className="flex-1 overflow-y-auto">
        {priorityGroups.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-zinc-400 dark:text-zinc-500">
            No backlog issues
          </div>
        ) : (
          priorityGroups.map(({ priority, issues: groupIssues }) => (
            <PriorityGroup
              key={priority}
              priority={priority}
              issues={groupIssues}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onUpdate={handleUpdate}
            />
          ))
        )}
      </div>
    </div>
  );
});

export default BacklogPage;
