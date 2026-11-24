'use client';

import { runInAction } from 'mobx';
import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { ISSUE_ARCHIVE_MUTATION, ISSUE_UNARCHIVE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const ISSUE_DELETE_MUTATION = `
  mutation IssueDelete($id: ID!) {
    issueDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

interface UseIssueRemovalOptions {
  /** Called after an issue is deleted (and archived, unless `onArchived` is given). */
  onDeleted?: (id: string) => void;
  /** Called after an issue is archived; defaults to `onRemoved`. */
  onRemoved?: (id: string) => void;
}

/**
 * Archive (optimistic, with an Undo toast), unarchive and delete for a single
 * issue. Delete is irreversible, so `requestDelete` stages a confirmation and
 * the caller renders `<ConfirmDialog {...deleteDialogProps} />` to complete it.
 * Shared by the list pages (`useIssueListPage`) and the issue detail surfaces.
 */
export function useIssueRemoval({ onDeleted, onRemoved }: UseIssueRemovalOptions = {}) {
  const t = useTranslations();
  const { issueStore } = useStore();
  const txQueue = useMemo(() => new TransactionQueue(), []);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; identifier: string } | null>(
    null,
  );

  const unarchive = useCallback(
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

  const archive = useCallback(
    (id: string) => {
      issueStore.optimisticUpdate(id, { archivedAt: new Date().toISOString() });
      const undoToastId = toast.undo(t('issues.archivedToast'), t('common.undo'), () =>
        unarchive(id),
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
      onRemoved?.(id);
    },
    [issueStore, txQueue, t, unarchive, onRemoved],
  );

  const remove = useCallback(
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
      (onDeleted ?? onRemoved)?.(id);
    },
    [issueStore, txQueue, t, onDeleted, onRemoved],
  );

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
        remove(pendingDelete.id);
      }
      setPendingDelete(null);
    },
    open: pendingDelete !== null,
    title: t('issues.deleteConfirmTitle'),
  };

  return { archive, deleteDialogProps, remove, requestDelete, unarchive };
}
