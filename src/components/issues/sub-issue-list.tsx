'use client';

import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import { getPriorityConfig } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// State type categories in display order
const STATE_CATEGORY_ORDER = [
  'started',
  'unstarted',
  'backlog',
  'completed',
  'cancelled',
] as const;

const STATE_CATEGORY_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  cancelled: 'Cancelled',
  completed: 'Done',
  started: 'In Progress',
  unstarted: 'Todo',
};

const CREATE_SUB_ISSUE_MUTATION = `
  mutation CreateSubIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      lastSyncId
      issue { id title identifier priority stateId }
    }
  }
`;

interface SubIssueListProps {
  parentIssueId: string;
  teamKey: string;
}

export const SubIssueList = observer(function SubIssueList({
  parentIssueId,
  teamKey,
}: SubIssueListProps) {
  const { issueStore, workflowStateStore } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // TransactionQueue per mount
  const tq = useMemo(() => new TransactionQueue(), []);

  // Derived in render so MobX (observer) tracks pool access and re-renders on changes
  const subIssues = Array.from(issueStore.pool.values()).filter(
    i => i.parentId === parentIssueId && !i.trashed && !i.archivedAt,
  );

  const grouped = new Map<string, typeof subIssues>();
  for (const issue of subIssues) {
    const state = workflowStateStore.findById(issue.stateId);
    const category = state?.type ?? 'backlog';
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)?.push(issue);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          Sub-issues ({subIssues.length})
        </button>
        {!showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add sub-issue
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateSubIssueForm
          parentIssueId={parentIssueId}
          teamKey={teamKey}
          tq={tq}
          onClose={() => setShowCreateForm(false)}
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
                        key={issue.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
                              state?.type === 'completed' ||
                              state?.type === 'cancelled'
                                ? (state.color ?? '#8b8c91')
                                : 'transparent',
                            borderColor: state?.color ?? '#8b8c91',
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
                            (state?.type === 'completed' ||
                              state?.type === 'cancelled') &&
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
            <p className="py-2 text-center text-xs text-zinc-400 italic">
              No sub-issues yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Create sub-issue form ────────────────────────────────────────────────────

interface CreateSubIssueFormProps {
  parentIssueId: string;
  teamKey: string;
  tq: TransactionQueue;
  onClose: () => void;
}

function CreateSubIssueForm({
  parentIssueId,
  teamKey: _teamKey,
  tq,
  onClose,
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
          { input: { parentId: parentIssueId, title: title.trim() } },
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
      onSubmit={handleSubmit}
      className="mt-2 flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-700"
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="Sub-issue title…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
        className="flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
      />
      <button
        type="button"
        onClick={onClose}
        className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={!title.trim() || submitting}
        className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? 'Adding…' : 'Add'}
      </button>
    </form>
  );
}
