'use client';

import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import { CREATE_SUB_ISSUE_MUTATION } from '@/lib/graphql-queries';
import { getPriorityConfig } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// State type categories in display order
const STATE_CATEGORY_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'cancelled'] as const;

const STATE_CATEGORY_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  cancelled: 'Cancelled',
  completed: 'Done',
  started: 'In Progress',
  unstarted: 'Todo',
};

interface SubIssueListProps {
  parentIssueId: string;
}

export const SubIssueList = observer(function SubIssueList({ parentIssueId }: SubIssueListProps) {
  const { issueStore, workflowStateStore } = useStore();

  // Resolve the parent issue's teamId, projectId, and cycleId so sub-issue
  // creation inherits them. If the issue isn't in the store yet, render nothing
  // — the panel only mounts when the issue is already loaded, so this guards
  // against race conditions only.
  const parentIssue = issueStore.findById(parentIssueId);
  const teamId = parentIssue?.teamId;
  const parentProjectId = parentIssue?.projectId ?? null;
  const parentCycleId = parentIssue?.cycleId ?? null;
  const [collapsed, setCollapsed] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // TransactionQueue per mount
  const tq = useMemo(() => new TransactionQueue(), []);

  // pool.size is the MobX reactive dependency per repo convention.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size values are the intentional reactive triggers
  const { subIssues, grouped } = useMemo(() => {
    const issues = Array.from(issueStore.pool.values()).filter(
      i => i.parentId === parentIssueId && !i.trashed && !i.archivedAt,
    );
    const g = new Map<string, typeof issues>();
    for (const issue of issues) {
      const state = workflowStateStore.findById(issue.stateId);
      const category = state?.type ?? 'backlog';
      if (!g.has(category)) {
        g.set(category, []);
      }
      g.get(category)?.push(issue);
    }
    return { grouped: g, subIssues: issues };
  }, [parentIssueId, issueStore.pool.size, workflowStateStore.pool.size]);

  // Guard: parent issue not yet in store — can happen during a race between
  // bootstrap and panel open; renders nothing rather than using an empty teamId
  // that would make sub-issue creation silently fail server-side.
  if (!teamId) {
    return null;
  }

  const completedCount = subIssues.filter(
    i => workflowStateStore.findById(i.stateId)?.type === 'completed',
  ).length;
  const completionPct = subIssues.length > 0 ? (completedCount / subIssues.length) * 100 : 0;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          onClick={() => setCollapsed(c => !c)}
          type="button"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Sub-issues ({subIssues.length})
        </button>
        {subIssues.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
              {completedCount}/{subIssues.length}
            </span>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-300"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        )}
        {!showCreateForm && (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={() => setShowCreateForm(true)}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            Add sub-issue
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateSubIssueForm
          onClose={() => setShowCreateForm(false)}
          parentCycleId={parentCycleId}
          parentIssueId={parentIssueId}
          parentProjectId={parentProjectId}
          teamId={teamId}
          tq={tq}
        />
      )}

      {!collapsed && (
        <div className="mt-2 space-y-3">
          {STATE_CATEGORY_ORDER.map(category => {
            const issues = grouped.get(category);
            if (!issues?.length) {
              return null;
            }
            return (
              <div key={category}>
                <p className="mb-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  {STATE_CATEGORY_LABELS[category] ?? category}
                </p>
                <ul className="space-y-0.5">
                  {issues.map(issue => {
                    const priorityCfg = getPriorityConfig(issue.priority);
                    const state = workflowStateStore.findById(issue.stateId);
                    return (
                      <li
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        key={issue.id}
                      >
                        {/* Priority dot */}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: priorityCfg.color }}
                          title={priorityCfg.label}
                        />
                        {/* State color dot */}
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm border"
                          style={{
                            backgroundColor:
                              state?.type === 'completed' || state?.type === 'cancelled'
                                ? (state.color ?? 'var(--state-default)')
                                : 'transparent',
                            borderColor: state?.color ?? 'var(--state-default)',
                          }}
                          title={state?.name}
                        />
                        {/* Identifier */}
                        <span className="font-mono text-xs text-zinc-400 shrink-0">
                          {issue.identifier}
                        </span>
                        {/* Title */}
                        <span
                          className={cn(
                            'flex-1 truncate text-zinc-700 dark:text-zinc-300',
                            (state?.type === 'completed' || state?.type === 'cancelled') &&
                              'line-through text-zinc-400',
                          )}
                        >
                          {issue.title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {subIssues.length === 0 && !showCreateForm && (
            <p className="py-2 text-center text-xs text-zinc-400 italic">No sub-issues yet.</p>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Create sub-issue form ────────────────────────────────────────────────────

interface CreateSubIssueFormProps {
  onClose: () => void;
  parentCycleId: string | null;
  parentIssueId: string;
  parentProjectId: string | null;
  teamId: string;
  tq: TransactionQueue;
}

function CreateSubIssueForm({
  parentIssueId,
  teamId,
  tq,
  onClose,
  parentProjectId,
  parentCycleId,
}: CreateSubIssueFormProps) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await new Promise<void>((resolve, reject) => {
        tq.enqueue(
          CREATE_SUB_ISSUE_MUTATION,
          {
            input: {
              cycleId: parentCycleId ?? undefined,
              parentId: parentIssueId,
              projectId: parentProjectId ?? undefined,
              teamId,
              title: title.trim(),
            },
          },
          {
            onError: err => reject(err),
            onSuccess: () => resolve(),
          },
        );
      });
      onClose();
    } catch {
      toast.error('Failed to create sub-issue');
      setSubmitting(false);
    }
  };

  return (
    <form
      className="mt-2 flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
      onSubmit={handleSubmit}
    >
      <input
        className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        placeholder="Sub-issue title…"
        ref={inputRef}
        type="text"
        value={title}
      />
      <button
        className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        onClick={onClose}
        type="button"
      >
        Cancel
      </button>
      <button
        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        disabled={!title.trim() || submitting}
        type="submit"
      >
        {submitting ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}
