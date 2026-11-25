'use client';

import { useCallback, useState } from 'react';
import type { BoardGroupBy, BoardSwimlaneBy } from '@/components/issues/board-view';
import type { ListGroupBy } from '@/components/issues/issue-list-view';
import type { ViewMode } from '@/components/issues/view-toggle';
import type { ListOrderBy } from '@/components/views/view-layout';
import { COMPLETED_ISSUES_MODES, type CompletedIssuesMode } from '@/lib/issue-list-visibility';

export interface ListDisplayPrefs {
  boardGroupBy: BoardGroupBy;
  completed: CompletedIssuesMode;
  listGroupBy: ListGroupBy;
  orderBy: ListOrderBy;
  swimlaneBy: BoardSwimlaneBy;
  viewMode: ViewMode;
}

export const DEFAULT_LIST_DISPLAY_PREFS: ListDisplayPrefs = {
  boardGroupBy: 'status',
  completed: 'all',
  listGroupBy: 'status',
  orderBy: 'manual',
  swimlaneBy: 'none',
  viewMode: 'list',
};

const ALLOWED: { [K in keyof ListDisplayPrefs]: readonly ListDisplayPrefs[K][] } = {
  boardGroupBy: ['status', 'assignee', 'priority'],
  completed: COMPLETED_ISSUES_MODES,
  listGroupBy: ['status', 'assignee', 'priority', 'project', 'cycle', 'label', 'none'],
  orderBy: ['manual', 'priority', 'updated', 'created', 'dueDate'],
  swimlaneBy: ['assignee', 'priority', 'none'],
  viewMode: ['list', 'board', 'timeline'],
};

const STORAGE_PREFIX = 'bilinear:listDisplay:v1:';

/** Reads a team's stored display prefs; any missing or unrecognised field falls back to its default. */
export function readListDisplayPrefs(teamKey: string): ListDisplayPrefs {
  const prefs: ListDisplayPrefs = { ...DEFAULT_LIST_DISPLAY_PREFS };
  if (typeof window === 'undefined') {
    return prefs;
  }
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + teamKey) ?? '');
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of Object.keys(ALLOWED) as (keyof ListDisplayPrefs)[]) {
        const value = record[key];
        if ((ALLOWED[key] as readonly unknown[]).includes(value)) {
          (prefs as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }
  } catch {
    // Storage unavailable or corrupt: defaults.
  }
  return prefs;
}

/**
 * Per-team view mode, grouping, ordering and swimlane choice, kept in
 * localStorage so a reload doesn't reset a board back to the list. Returns the
 * stored values (read once per mount — key the page on the team) and a `save`
 * for the live values.
 */
export function useListDisplayPrefs(teamKey: string): {
  initial: ListDisplayPrefs;
  save: (prefs: ListDisplayPrefs) => void;
} {
  const [initial] = useState(() => readListDisplayPrefs(teamKey));
  const save = useCallback(
    (prefs: ListDisplayPrefs) => {
      try {
        window.localStorage.setItem(STORAGE_PREFIX + teamKey, JSON.stringify(prefs));
      } catch {
        // Storage blocked: the choice just lasts for this session.
      }
    },
    [teamKey],
  );
  return { initial, save };
}
