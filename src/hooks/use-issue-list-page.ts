'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { BoardGroupBy, BoardSwimlaneBy } from '@/components/issues/board-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import type { ViewMode } from '@/components/issues/view-toggle';
import { useHotkeys } from '@/hooks/use-hotkeys';
import type { DBIssueLabel } from '@/lib/db';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail } from '@/types/issues';

interface UseIssueListPageOptions {
  /** Route to replace on Escape / detail-panel close (no query params). */
  basePath: string;
  /** Build the href to push when opening an issue's detail panel. */
  buildHref: (id: string) => string;
  /** Currently visible/filtered issues, used for j/k navigation bounds. */
  issues: IssueDetail[];
  /** Extra side effect to run when an issue is opened (e.g. recent-items tracking). */
  onOpen?: (id: string) => void;
}

/**
 * Shared selection/detail-panel/view-mode state and keyboard shortcuts for an
 * issue list page (team issues, my issues). Callers layer any page-specific
 * hotkeys (e.g. archive, extra property pickers) on top using the returned
 * setters.
 */
export function useIssueListPage({ issues, basePath, buildHref, onOpen }: UseIssueListPageOptions) {
  const router = useRouter();
  const { issueStore, labelStore } = useStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<OpenProperty>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [boardGroupBy, setBoardGroupBy] = useState<BoardGroupBy>('status');
  const [swimlaneBy, setSwimlaneBy] = useState<BoardSwimlaneBy>('none');

  const selectedIndex = issues.findIndex(i => i.id === selectedId);
  const hasSelection = selectedId !== null;

  const closeDetail = useCallback(() => {
    setDetailIssueId(null);
    router.replace(basePath, { scroll: false });
  }, [basePath, router]);

  // J / K — navigate list
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

  // Enter — open detail
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

  // Escape — clear selection / close detail
  useHotkeys('escape', () => (detailIssueId ? closeDetail() : setSelectedId(null)), {}, [
    detailIssueId,
    closeDetail,
  ]);

  // Issue context shortcuts — only active when an issue is selected
  useHotkeys('s', () => setOpenProperty('status'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('a', () => setOpenProperty('assignee'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('p', () => setOpenProperty('priority'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('l', () => setOpenProperty('label'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('d', () => setOpenProperty('dueDate'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('shift+e', () => setOpenProperty('estimate'), { enabled: hasSelection }, [
    hasSelection,
  ]);

  // Alt+1 — list view, Alt+2 — board view, Alt+3 — timeline view
  useHotkeys('alt+1', () => setViewMode('list'), {}, []);
  useHotkeys('alt+2', () => setViewMode('board'), {}, []);
  useHotkeys('alt+3', () => setViewMode('timeline'), {}, []);

  const handleOpen = useCallback(
    (id: string) => {
      setDetailIssueId(id);
      router.replace(buildHref(id), { scroll: false });
      onOpen?.(id);
    },
    [buildHref, onOpen, router],
  );

  const detailIssue: IssueDetail | null = (() => {
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
  })();

  return {
    boardGroupBy,
    closeDetail,
    detailIssue,
    detailIssueId,
    handleOpen,
    hasSelection,
    openProperty,
    selectedId,
    setBoardGroupBy,
    setDetailIssueId,
    setOpenProperty,
    setSelectedId,
    setSwimlaneBy,
    setViewMode,
    swimlaneBy,
    viewMode,
  };
}
