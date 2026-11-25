'use client';

import { Link2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import type { CreateIssueInput } from '@/components/issues/create-issue-modal';
import { IssuePicker } from '@/components/issues/issue-picker';
import { PriorityIcon } from '@/components/properties/priority-icon';
import { SectionAddButton, SectionHeader } from '@/components/shared/section-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useIssueCreate } from '@/hooks/use-issue-create';
import { useIssueUpdate } from '@/hooks/use-issue-update';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// State type categories in display order. These are `WorkflowState.type`
// values, so the spelling is `canceled` (one L) — the same string
// `workflow-state.service.ts` validates and `team.service.ts` seeds. The
// `cancelled` translation *key* below is a separate namespace and keeps its
// own spelling.
const STATE_CATEGORY_ORDER = [
  'started',
  'unstarted',
  'triage',
  'backlog',
  'completed',
  'canceled',
] as const;

function getStateCategoryLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    backlog: t('issueDetail.subIssues.categories.backlog'),
    canceled: t('issueDetail.subIssues.categories.cancelled'),
    completed: t('issueDetail.subIssues.categories.done'),
    started: t('issueDetail.subIssues.categories.inProgress'),
    triage: t('issueDetail.subIssues.categories.triage'),
    unstarted: t('issueDetail.subIssues.categories.todo'),
  };
}

interface SubIssueListProps {
  parentIssueId: string;
}

export const SubIssueList = observer(function SubIssueList({ parentIssueId }: SubIssueListProps) {
  const t = useTranslations();
  const STATE_CATEGORY_LABELS = useMemo(() => getStateCategoryLabels(t), [t]);
  const { issueStore, teamStore, workflowStateStore } = useStore();

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

  // Same optimistic path as every other issue creation: the row appears at once
  // and the write queues, so adding a sub-issue works offline too.
  const createIssue = useIssueCreate(
    teamId ? teamStore.findById(teamId) : null,
    teamId ? workflowStateStore.findByTeamId(teamId) : [],
  );

  const updateIssue = useIssueUpdate();
  // "Add existing" must not offer: the parent itself, any of its ANCESTORS
  // (parenting an ancestor under its own descendant closes a loop) or its
  // current direct children (already sub-issues). Deeper descendants are
  // valid — re-parenting a grandchild up to this issue is a legitimate move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the reactive trigger
  const unlinkable = useMemo(() => {
    const ids = new Set<string>([parentIssueId]);
    const seen = new Set<string>();
    let cursor = issueStore.findById(parentIssueId)?.parentId ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      ids.add(cursor);
      cursor = issueStore.findById(cursor)?.parentId ?? null;
    }
    for (const issue of issueStore.pool.values()) {
      if (issue.parentId === parentIssueId) {
        ids.add(issue.id);
      }
    }
    return ids;
  }, [parentIssueId, issueStore.pool.size]);

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

  // Any category the order list doesn't know (a new workflow-state type) still
  // renders, after the known ones — the header counts every child, so the list
  // must show every child.
  const orderedCategories = [
    ...STATE_CATEGORY_ORDER,
    ...Array.from(grouped.keys()).filter(
      c => !(STATE_CATEGORY_ORDER as readonly string[]).includes(c),
    ),
  ];

  const completionPct = subIssues.length > 0 ? (completedCount / subIssues.length) * 100 : 0;

  return (
    <div>
      <SectionHeader
        action={
          !showCreateForm && (
            <>
              <IssuePicker
                excludeId={parentIssueId}
                excludeIds={unlinkable}
                onSelect={picked => updateIssue(picked.id, { parentId: parentIssueId })}
                // Icon-only below sm: with the count, progress and both actions
                // the header is wider than a phone and wraps the title.
                triggerChildren={
                  <span className="flex items-center gap-1 text-xs">
                    <Link2 className="h-3.5 w-3.5" />
                    <span className="max-sm:sr-only">{t('issueDetail.subIssues.addExisting')}</span>
                  </span>
                }
                triggerClassName="rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground-secondary"
                triggerTitle={t('issueDetail.subIssues.addExisting')}
              />
              <SectionAddButton
                label={t('issueDetail.subIssues.addSubIssue')}
                onClick={() => setShowCreateForm(true)}
              />
            </>
          )
        }
        collapsed={collapsed}
        count={subIssues.length}
        meta={
          subIssues.length > 0 && (
            <>
              <span className="text-xs tabular-nums text-muted-foreground">
                {completedCount}/{subIssues.length}
              </span>
              <ProgressBar
                className="h-1 w-20 max-sm:hidden"
                fillClassName="bg-success duration-300"
                value={completionPct}
              />
            </>
          )
        }
        onToggle={() => setCollapsed(c => !c)}
        title={t('issueDetail.subIssues.title')}
      />

      {showCreateForm && (
        <CreateSubIssueForm
          onClose={() => setShowCreateForm(false)}
          onCreate={createIssue}
          parentCycleId={parentCycleId}
          parentIssueId={parentIssueId}
          parentProjectId={parentProjectId}
        />
      )}

      {!collapsed && (
        <div className="mt-2 space-y-3">
          {orderedCategories.map(category => {
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
                    const state = workflowStateStore.findById(issue.stateId);
                    return (
                      <li
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        key={issue.id}
                      >
                        {/* Priority — the same icon the parent issue and every
                            list row use, not a colour-only dot. */}
                        <PriorityIcon className="h-3.5 w-3.5" priority={issue.priority} />
                        {/* State color dot */}
                        <span
                          className="h-3 w-3 shrink-0 rounded-sm border"
                          style={{
                            backgroundColor:
                              state?.type === 'completed' || state?.type === 'canceled'
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
                            (state?.type === 'completed' || state?.type === 'canceled') &&
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
  onCreate: (input: CreateIssueInput) => Promise<void>;
  parentCycleId: string | null;
  parentIssueId: string;
  parentProjectId: string | null;
}

function CreateSubIssueForm({
  parentIssueId,
  onClose,
  onCreate,
  parentProjectId,
  parentCycleId,
}: CreateSubIssueFormProps) {
  const t = useTranslations();
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      return;
    }
    // Optimistic: the row is in the store before this returns, and a failure
    // is reported (and rolled back) by `useIssueCreate`.
    void onCreate({
      cycleId: parentCycleId ?? undefined,
      labelIds: [],
      parentId: parentIssueId,
      priority: 0,
      projectId: parentProjectId ?? undefined,
      title: title.trim(),
    });
    onClose();
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
        disabled={!title.trim()}
        type="submit"
      >
        {t('issueDetail.subIssues.add')}
      </button>
    </form>
  );
}
