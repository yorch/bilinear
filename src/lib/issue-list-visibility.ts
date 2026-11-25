/**
 * Which issues a list page keeps out of view by default: finished work (per the
 * "Completed issues" display option) and, on a triage-enabled team, issues
 * still waiting in the triage queue. Pure, so the rules are testable without a
 * page.
 */

import type { FilterSet } from '@/lib/filter-engine';

export type CompletedIssuesMode = 'all' | 'pastWeek' | 'none';

export const COMPLETED_ISSUES_MODES: readonly CompletedIssuesMode[] = ['all', 'pastWeek', 'none'];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface CompletableIssue {
  canceledAt?: string | null;
  completedAt?: string | null;
  stateId: string;
}

/**
 * The "Completed issues" option only has a control in list mode, so it must
 * only filter in list mode — on a board or timeline, with no control to undo
 * it, hidden issues would be unrecoverable.
 */
export function effectiveCompletedMode(
  viewMode: string,
  completed: CompletedIssuesMode,
): CompletedIssuesMode {
  return viewMode === 'list' ? completed : 'all';
}

/**
 * Apply the "Completed issues" option. `closedStateIds` are the team's
 * completed/canceled workflow states. In `pastWeek` mode a closed issue with no
 * recorded close time cannot be shown to be recent, so it is hidden.
 */
export function filterCompletedIssues<T extends CompletableIssue>(
  issues: T[],
  mode: CompletedIssuesMode,
  closedStateIds: ReadonlySet<string>,
  now: number = Date.now(),
): T[] {
  if (mode === 'all') {
    return issues;
  }
  return issues.filter(issue => {
    if (!closedStateIds.has(issue.stateId)) {
      return true;
    }
    if (mode === 'none') {
      return false;
    }
    const closedAt = issue.completedAt ?? issue.canceledAt;
    const closedMs = closedAt ? new Date(closedAt).getTime() : Number.NaN;
    return Number.isFinite(closedMs) && now - closedMs <= WEEK_MS;
  });
}

/** Ids of the workflow states of the given types (e.g. completed + canceled). */
export function stateIdsOfType(
  states: { id: string; type: string }[],
  types: readonly string[],
): Set<string> {
  return new Set(states.filter(s => types.includes(s.type)).map(s => s.id));
}

/**
 * Drop issues sitting in the triage state. Applies only when the team has
 * triage on: an un-triaged issue belongs in the triage queue, not in the team's
 * working list or board.
 */
export function excludeTriageIssues<T extends { stateId: string }>(
  issues: T[],
  triageEnabled: boolean,
  triageStateIds: ReadonlySet<string>,
): T[] {
  if (!triageEnabled || triageStateIds.size === 0) {
    return issues;
  }
  return issues.filter(i => !triageStateIds.has(i.stateId));
}

/**
 * The filters to store when saving the backlog page as a view: the backlog
 * scope (`status in <backlog states>`) ANDed with the user's conditions.
 *
 * The filter model is flat — one composition for the whole set — so a user set
 * combined with OR (of two or more conditions) cannot be ANDed with the scope
 * without changing its meaning, and dropping the user's conditions would save a
 * different view than the one on screen. Returns `null` for that case so the
 * caller can refuse rather than save something wrong.
 */
export function buildBacklogViewFilters(
  filterSet: FilterSet,
  backlogStateIds: readonly string[],
): FilterSet | null {
  if (filterSet.composition === 'or' && filterSet.conditions.length > 1) {
    return null;
  }
  return {
    composition: 'and',
    conditions: [
      { field: 'status', operator: 'in', value: [...backlogStateIds] },
      ...filterSet.conditions,
    ],
  };
}
