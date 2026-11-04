'use client';

import { runInAction } from 'mobx';
import { useCallback, useMemo, useState } from 'react';
import type { BoardGroupBy, BoardSwimlaneBy } from '@/components/issues/board-view';
import type { OpenProperty } from '@/components/issues/issue-row';
import type { ViewMode } from '@/components/issues/view-toggle';
import { stepVisualOrder } from '@/components/issues/visual-order';
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

/** Row cells that `IssueRow` hides below the `lg` breakpoint. */
const ROW_HIDDEN_BELOW_LG: ReadonlySet<string> = new Set([
  'assignee',
  'cycle',
  'dueDate',
  'estimate',
  'label',
]);

function isLargeViewport(): boolean {
  return (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(min-width: 1024px)').matches
  );
}

/**
 * Point the address bar at the open issue without leaving the list.
 *
 * `router.replace` was used here, which is a real navigation: now that
 * `/issue/[id]` renders a full page rather than the same overlay panel the list
 * shows, replacing the URL unmounted the list and every list interaction ended
 * up on the standalone page. That was invisible before only because the route
 * and the overlay rendered identical markup.
 *
 * The URL still has to change — the whole point is that an open issue is
 * copyable, and reloading it lands on the full page. `history.replaceState` is
 * what does that without asking the router to render anything; Next integrates
 * with the native History API, so back/forward keep working.
 */
function syncUrl(href: string): void {
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', href);
  }
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

  const hasSelection = selectedId !== null;

  const closeDetail = useCallback(() => {
    setDetailIssueId(null);
    syncUrl(basePath);
  }, [basePath]);

  const handleOpen = useCallback(
    (id: string) => {
      setDetailIssueId(id);
      syncUrl(buildHref(id));
      onOpen?.(id);
    },
    [buildHref, onOpen],
  );

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

  /** Archive several issues with ONE undo toast instead of one per row. */
  const handleArchiveMany = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      const archivedAt = new Date().toISOString();
      for (const id of ids) {
        issueStore.optimisticUpdate(id, { archivedAt });
      }
      const undoToastId = toast.undo(
        t('issues.archivedManyToast', { count: ids.length }),
        t('common.undo'),
        () => {
          for (const id of ids) {
            handleUnarchive(id);
          }
        },
      );
      for (const id of ids) {
        txQueue.enqueue(
          ISSUE_ARCHIVE_MUTATION,
          { id },
          {
            onError: err => {
              toast.dismiss(undoToastId);
              toast.error(getErrorMessage(err, t('issues.archiveFailed')));
              issueStore.optimisticUpdate(id, { archivedAt: null });
            },
          },
        );
      }
      setSelectedId(prev => (prev && ids.includes(prev) ? null : prev));
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
    () =>
      setSelectedId(
        stepVisualOrder(
          selectedId,
          1,
          issues.map(i => i.id),
        ),
      ),
    {},
    [selectedId, issues],
  );
  useHotkeys(
    'k',
    () =>
      setSelectedId(
        stepVisualOrder(
          selectedId,
          -1,
          issues.map(i => i.id),
        ),
      ),
    {},
    [selectedId, issues],
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

  // Issue context shortcuts — only active when an issue is selected.
  //
  // Below `lg` the row hides the assignee / labels / due date / cycle / estimate
  // cells (`max-lg:hidden`), so a popover forced open on one would open inside a
  // `display:none` parent: nothing visible, focus lost, listeners armed. There
  // the shortcut opens the detail panel instead, where every property is shown.
  const openPropertyOrDetail = (property: NonNullable<OpenProperty>) => {
    if (selectedId && ROW_HIDDEN_BELOW_LG.has(property) && !isLargeViewport()) {
      handleOpen(selectedId);
      return;
    }
    setOpenProperty(property);
  };
  useHotkeys('s', () => openPropertyOrDetail('status'), { enabled: hasSelection }, [hasSelection]);
  useHotkeys('a', () => openPropertyOrDetail('assignee'), { enabled: hasSelection }, [
    hasSelection,
    selectedId,
  ]);
  useHotkeys('p', () => openPropertyOrDetail('priority'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys('l', () => openPropertyOrDetail('label'), { enabled: hasSelection }, [
    hasSelection,
    selectedId,
  ]);
  useHotkeys('d', () => openPropertyOrDetail('dueDate'), { enabled: hasSelection }, [
    hasSelection,
    selectedId,
  ]);
  useHotkeys('shift+e', () => openPropertyOrDetail('estimate'), { enabled: hasSelection }, [
    hasSelection,
    selectedId,
  ]);
  // Shift+P / Q — project and cycle pickers. Rows without a cycle cell (a
  // page spanning teams) simply have nothing to open, so this is safe everywhere.
  useHotkeys('shift+p', () => openPropertyOrDetail('project'), { enabled: hasSelection }, [
    hasSelection,
  ]);
  useHotkeys('q', () => openPropertyOrDetail('cycle'), { enabled: hasSelection }, [
    hasSelection,
    selectedId,
  ]);

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
    handleArchiveMany,
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
