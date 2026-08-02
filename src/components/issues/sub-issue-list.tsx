'use client';

import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import { priorityLabelKey } from '@/components/properties/priority-icon';
import { useTranslations } from '@/hooks/use-translations';
import { CREATE_SUB_ISSUE_MUTATION } from '@/lib/graphql-queries';
import { getPriorityConfig } from '@/lib/issue-utils';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// State type categories in display order
const STATE_CATEGORY_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'cancelled'] as const;

function getStateCategoryLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    backlog: t('issueDetail.subIssues.categories.backlog'),
    cancelled: t('issueDetail.subIssues.categories.cancelled'),
    completed: t('issueDetail.subIssues.categories.done'),
    started: t('issueDetail.subIssues.categories.inProgress'),
    unstarted: t('issueDetail.subIssues.categories.todo'),
  };
}

interface SubIssueListProps {
  parentIssueId: string;
}

export const SubIssueList = observer(function SubIssueList({ parentIssueId }: SubIssueListProps) {
  const t = useTranslations();
  const STATE_CATEGORY_LABELS = useMemo(() => getStateCategoryLabels(t), [t]);
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
  const { subIssues, grouped, completedCount } = useMemo(() => {
    const issues = Array.from(issueStore.pool.values()).filter(
      i => i.parentId === parentIssueId && !i.trashed && !i.archivedAt,
    );
    const g = new Map<string, typeof issues>();
    let done = 0;
    for (const issue of issues) {
      const state = workflowStateStore.findById(issue.stateId);
      const category = state?.type ?? 'backlog';
      if (category === 'completed') {
        done++;
      }
      if (!g.has(category)) {
        g.set(category, []);
      }
      g.get(category)?.push(issue);
    }
    return { completedCount: done, grouped: g, subIssues: issues };
  }, [parentIssueId, issueStore.pool.size, workflowStateStore.pool.size]);

  // Guard: parent issue not yet in store — can happen during a race between
  // bootstrap and panel open; renders nothing rather than using an empty teamId
  // that would make sub-issue creation silently fail server-side.
  if (!teamId) {
    return null;
  }

  const completionPct = subIssues.length > 0 ? (completedCount / subIssues.length) * 100 : 0;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground-secondary"
          onClick={() => setCollapsed(c => !c)}
          type="button"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {t('issueDetail.subIssues.title')} ({subIssues.length})
        </button>
        {subIssues.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {completedCount}/{subIssues.length}
            </span>
            <div className="h-1 w-20 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success transition-all duration-300"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        )}
        {!showCreateForm && (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
            onClick={() => setShowCreateForm(true)}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('issueDetail.subIssues.addSubIssue')}
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
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {STATE_CATEGORY_LABELS[category] ?? category}
                </p>
                <ul className="space-y-0.5">
                  {issues.map(issue => {
                    const priorityCfg = getPriorityConfig(issue.priority);
                    const state = workflowStateStore.findById(issue.stateId);
                    return (
                      <li
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        key={issue.id}
                      >
                        {/* Priority dot */}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: priorityCfg.color }}
                          title={t(priorityLabelKey(issue.priority))}
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
                        <span className="font-mono text-xs text-muted-foreground shrink-0">
                          {issue.identifier}
                        </span>
                        {/* Title */}
                        <span
                          className={cn(
                            'flex-1 truncate text-foreground-secondary',
                            (state?.type === 'completed' || state?.type === 'cancelled') &&
                              'line-through text-muted-foreground',
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
            <p className="py-2 text-center text-xs text-muted-foreground italic">
              {t('issueDetail.subIssues.empty')}
            </p>
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
  const t = useTranslations();
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
      toast.error(t('issueDetail.subIssues.failedToCreate'));
      setSubmitting(false);
    }
  };

  return (
    <form
      className="mt-2 flex items-center gap-2 rounded-md border border-border px-3 py-2"
      onSubmit={handleSubmit}
    >
      <input
        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            // Consume the keypress so the detail panel's window-level
            // Escape listener doesn't also close the whole panel.
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder={t('issueDetail.subIssues.titlePlaceholder')}
        ref={inputRef}
        type="text"
        value={title}
      />
      <button
        className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground-secondary"
        onClick={onClose}
        type="button"
      >
        {t('common.cancel')}
      </button>
      <button
        className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        disabled={!title.trim() || submitting}
        type="submit"
      >
        {submitting ? t('issueDetail.subIssues.adding') : t('issueDetail.subIssues.add')}
      </button>
    </form>
  );
}
