'use client';

import { runInAction } from 'mobx';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import type { BoardGroupBy, BoardSwimlaneBy } from '@/components/issues/board-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import type { ViewMode } from '@/components/issues/view-toggle';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useTranslations } from '@/hooks/use-translations';
import { ISSUE_ARCHIVE_MUTATION, ISSUE_UNARCHIVE_MUTATION } from '@/lib/graphql-queries';
import { toIssueDetail } from '@/lib/issue-mappers';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';
import type { IssueDetail } from '@/types/issues';

const ISSUE_DELETE_MUTATION = `
  mutation IssueDelete($id: ID!) {
    issueDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

interface UseIssueListPageOptions {
  /** Route to replace on Escape / detail-panel close (no query params). */
  basePath: string;
  /** Build the href to push when opening an issue's detail panel. */
  buildHref: (id: string) => string;
  /** Board grouping to start with (a saved view's stored `groupBy`). */
  initialBoardGroupBy?: BoardGroupBy;
  /** View mode to start with (a saved view's stored `layout`). */
  initialViewMode?: ViewMode;
  /** Currently visible/filtered issues, used for j/k navigation bounds. */
  issues: IssueDetail[];
  /** Extra side effect to run when an issue is opened (e.g. recent-items tracking). */
  onOpen?: (id: string) => void;
}

/**
 * Shared selection/detail-panel/view-mode state, keyboard shortcuts and the
 * archive / delete actions for an issue list page (team issues, backlog, my
 * issues, saved views). Archive is optimistic with an Undo toast; delete is
 * irreversible, so `requestDelete` stages a confirmation and the page renders
 * `<ConfirmDialog {...deleteDialogProps} />` to complete it.
 */
export function useIssueListPage({
  issues,
  basePath,
  buildHref,
  initialBoardGroupBy,
  initialViewMode,
  onOpen,
}: UseIssueListPageOptions) {
  const router = useRouter();
  const t = useTranslations();
  const { issueStore, labelStore } = useStore();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<OpenProperty>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode ?? 'list');
  const [boardGroupBy, setBoardGroupBy] = useState<BoardGroupBy>(initialBoardGroupBy ?? 'status');
  const [swimlaneBy, setSwimlaneBy] = useState<BoardSwimlaneBy>('none');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; identifier: string } | null>(
    null,
  );

  const selectedIndex = issues.findIndex(i => i.id === selectedId);
  const hasSelection = selectedId !== null;

  const closeDetail = useCallback(() => {
    setDetailIssueId(null);
    router.replace(basePath, { scroll: false });
  }, [basePath, router]);

  // ── Archive / delete ───────────────────────────────────────────────────────

  const handleUnarchive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: null });
      txQueue.enqueue(
        ISSUE_UNARCHIVE_MUTATION,
        { id },
        {
          onError: err => {
            toast.error(getErrorMessage(err, t('issues.restoreFailed')));
            issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
          },
        },
      );
    },
    [issueStore, txQueue, t],
  );

  const handleArchive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      const undoToastId = toast.undo(t('issues.archivedToast'), t('common.undo'), () =>
        handleUnarchive(id),
      );
      txQueue.enqueue(
        ISSUE_ARCHIVE_MUTATION,
        { id },
        {
          onError: err => {
            // The archive never happened server-side: retire the stale Undo
            // affordance before surfacing the failure and rolling back.
            toast.dismiss(undoToastId);
            toast.error(getErrorMessage(err, t('issues.archiveFailed')));
            issueStore.optimisticUpdate(id, { archivedAt: null });
          },
        },
      );
      setSelectedId(prev => (prev === id ? null : prev));
    },
    [issueStore, txQueue, t, handleUnarchive],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const snapshot = issueStore.findById(id);
      runInAction(() => {
        issueStore.pool.delete(id);
      });
      txQueue.enqueue(
        ISSUE_DELETE_MUTATION,
        { id },
        {
          onError: err => {
            toast.error(getErrorMessage(err, t('issues.deleteFailed')));
            // Restore the issue optimistically if the server rejects the delete
            if (snapshot) {
              issueStore.applySyncAction('I', id, snapshot);
            }
          },
          onSuccess: () => {
            toast.success(t('issues.deletedToast'));
          },
        },
      );
      setSelectedId(prev => (prev === id ? null : prev));
      setDetailIssueId(prev => (prev === id ? null : prev));
    },
    [issueStore, txQueue, t],
  );

  // Delete is irreversible (no restore mutation), so it goes through a
  // confirmation dialog instead of firing straight from the context menu.
  const requestDelete = useCallback(
    (id: string) => {
      const issue = issueStore.findById(id);
      setPendingDelete({ id, identifier: issue?.identifier ?? '' });
    },
    [issueStore],
  );

  const deleteDialogProps = {
    message: t('issues.deleteConfirmBody', { identifier: pendingDelete?.identifier ?? '' }),
    onCancel: () => setPendingDelete(null),
    onConfirm: () => {
      if (pendingDelete) {
        handleDelete(pendingDelete.id);
      }
      setPendingDelete(null);
    },
    open: pendingDelete !== null,
    title: t('issues.deleteConfirmTitle'),
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

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
  // Shift+P / Q — project and cycle pickers. Rows without a cycle cell (a
  // page spanning teams) simply have nothing to open, so this is safe everywhere.
  useHotkeys('shift+p', () => setOpenProperty('project'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys('q', () => setOpenProperty('cycle'), { enabled: hasSelection }, [hasSelection]);

  // Backspace / Delete — archive the selected issue (undoable via toast)
  useHotkeys(
    ['backspace', 'delete'],
    () => {
      if (selectedId) {
        handleArchive(selectedId);
      }
    },
    { enabled: hasSelection },
    [selectedId, handleArchive, hasSelection],
  );

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
    return toIssueDetail(raw, labelStore);
  })();

  return {
    boardGroupBy,
    closeDetail,
    deleteDialogProps,
    detailIssue,
    detailIssueId,
    handleArchive,
    handleOpen,
    hasSelection,
    openProperty,
    requestDelete,
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
