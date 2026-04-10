'use client';

import { ArrowLeft, Calendar, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface CycleDetailViewProps {
  cycleId: string;
  workspaceKey: string;
  teamKey: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const CycleDetailView = observer(function CycleDetailView({
  cycleId,
  workspaceKey,
  teamKey,
}: CycleDetailViewProps) {
  const { cycleStore, issueStore, teamStore, workflowStateStore } = useStore();

  const txQueue = useMemo(() => new TransactionQueue(), []);

  const cycle = cycleStore.findById(cycleId);

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Focus the name input when editing starts
  useEffect(() => {
    if (editingName) {
      nameInputRef.current?.focus();
    }
  }, [editingName]);

  const handleRemoveIssue = useCallback(
    (issueId: string) => {
      const snapshot = issueStore.findById(issueId);
      issueStore.optimisticUpdate(issueId, { cycleId: null });
      txQueue.enqueue(
        `mutation CycleRemoveIssue($issueId: ID!) {
          cycleRemoveIssue(issueId: $issueId) { success lastSyncId issue { id cycleId } }
        }`,
        { issueId },
        {
          onError: () => {
            if (snapshot) {
              issueStore.optimisticUpdate(issueId, snapshot);
            }
            toast.error('Failed to remove issue from cycle');
          },
        },
      );
    },
    [issueStore, txQueue],
  );

  if (!cycle) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Cycle not found.
      </div>
    );
  }

  const cycleIssues = issueStore.findByCycleId(cycle.id);
  const completedIssues = cycleIssues.filter(i => i.completedAt);
  const progress =
    cycleIssues.length > 0
      ? Math.round((completedIssues.length / cycleIssues.length) * 100)
      : 0;

  const now = Date.now();
  const startsAtMs = new Date(cycle.startsAt).getTime();
  const endsAtMs = new Date(cycle.endsAt).getTime();
  const isActive = !cycle.completedAt && startsAtMs <= now && endsAtMs > now;
  const isUpcoming = startsAtMs > now;

  const statusLabel = isActive
    ? 'Active'
    : isUpcoming
      ? 'Upcoming'
      : 'Completed';
  const statusColor = isActive
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
    : isUpcoming
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400'
      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';

  const displayName = cycle.name || `Cycle ${cycle.number}`;

  const handleSaveName = () => {
    const trimmed = nameValue.trim();
    setEditingName(false);
    if (!trimmed || trimmed === (cycle.name ?? '')) {
      return;
    }
    const snapshot = { ...cycle };
    cycleStore.optimisticUpdate(cycle.id, { name: trimmed });
    txQueue.enqueue(
      `mutation CycleUpdate($id: ID!, $input: CycleUpdateInput!) {
        cycleUpdate(id: $id, input: $input) { success lastSyncId cycle { id number name description startsAt endsAt progress scope teamId organizationId createdAt updatedAt } }
      }`,
      { id: cycle.id, input: { name: trimmed } },
      {
        onError: () => {
          cycleStore.optimisticUpdate(cycle.id, snapshot);
          toast.error('Failed to update cycle name');
        },
      },
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
        <Link
          href={`/${workspaceKey}/team/${teamKey}/cycles`}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <RefreshCw className="h-4 w-4 text-zinc-400" />
        {editingName ? (
          <input
            ref={nameInputRef}
            type="text"
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleSaveName();
              }
              if (e.key === 'Escape') {
                setEditingName(false);
              }
            }}
            className="flex-1 rounded border border-indigo-500 bg-transparent px-1 text-sm font-semibold text-zinc-900 outline-none dark:text-zinc-100"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameValue(cycle.name ?? '');
              setEditingName(true);
            }}
            className="text-sm font-semibold text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
            title="Click to edit name"
          >
            {displayName}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                statusColor,
              )}
            >
              {statusLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-zinc-400" />
              <span className="text-xs text-zinc-500">
                {formatDate(cycle.startsAt)} &rarr; {formatDate(cycle.endsAt)}
              </span>
            </div>
          </div>

          {cycle.description && (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              {cycle.description}
            </p>
          )}

          {/* Progress */}
          <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Progress
              </span>
              <span className="text-xs tabular-nums text-zinc-500">
                {completedIssues.length} / {cycleIssues.length} issues (
                {progress}%)
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Issues */}
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Issues ({cycleIssues.length})
              </h3>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {cycleIssues.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-400">
                  No issues in this cycle yet. Use{' '}
                  <kbd className="mx-0.5 rounded border px-1 font-mono text-[10px]">
                    Q
                  </kbd>{' '}
                  on any issue to assign it to a cycle.
                </p>
              ) : (
                cycleIssues.map(issue => {
                  const state = workflowStateStore.findById(issue.stateId);
                  const team = teamStore.findById(issue.teamId);
                  return (
                    <div
                      key={issue.id}
                      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      {state && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full border-2"
                          style={{ borderColor: state.color }}
                        />
                      )}
                      <span className="shrink-0 font-mono text-xs text-zinc-400">
                        {issue.identifier}
                      </span>
                      <Link
                        href={`/${workspaceKey}/team/${team?.key ?? teamKey}`}
                        className="min-w-0 flex-1 truncate text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                      >
                        {issue.title}
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleRemoveIssue(issue.id)}
                        className="hidden rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 group-hover:block dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                        title="Remove from cycle"
                      >
                        Remove
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
