'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { ISSUE_UPDATE_MUTATION, ISSUES_BULK_UPDATE_MUTATION } from '@/lib/graphql-queries';
import { toIssueSyncRow } from '@/lib/issue-mappers';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Optimistic bulk issue-field update shared by the issue-list pages (team
 * page, my-issues): apply the patch to every id immediately, enqueue one
 * mutation for the batch, roll back + toast on failure, and reconcile with
 * the server rows on success. Mirrors useIssueUpdate's single-issue shape.
 */
export function useIssuesBulkUpdate(): (ids: string[], patch: Record<string, unknown>) => void {
  const { issueStore } = useStore();
  const t = useTranslations();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  return useCallback(
    (ids: string[], patch: Record<string, unknown>) => {
      const snapshots = ids.map(id => ({ id, snapshot: issueStore.findById(id) }));
      for (const id of ids) {
        issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);
      }
      // A team move allocates a new number/identifier per issue and remaps its
      // workflow state, which the batch mutation deliberately refuses — so it
      // goes out as one issueUpdate per row (each its own SyncAction).
      if ('teamId' in patch) {
        for (const id of ids) {
          txQueue.enqueue(
            ISSUE_UPDATE_MUTATION,
            { id, input: patch },
            {
              onError: err => {
                toast.error(getErrorMessage(err, t('issues.bulkUpdateFailed')));
                const snapshot = snapshots.find(s => s.id === id)?.snapshot;
                if (snapshot) {
                  issueStore.optimisticUpdate(id, snapshot);
                }
              },
              onSuccess: data => {
                const updated = (data as { issueUpdate?: { issue?: Record<string, unknown> } })
                  ?.issueUpdate?.issue;
                const row = updated ? toIssueSyncRow(updated) : null;
                if (row) {
                  issueStore.applySyncAction('U', id, row);
                }
              },
            },
          );
        }
        return;
      }
      txQueue.enqueue(
        ISSUES_BULK_UPDATE_MUTATION,
        { ids, input: patch },
        {
          onError: err => {
            toast.error(getErrorMessage(err, t('issues.bulkUpdateFailed')));
            for (const { id, snapshot } of snapshots) {
              if (snapshot) {
                issueStore.optimisticUpdate(id, snapshot);
              }
            }
          },
          onSuccess: data => {
            const updated =
              (data as { issuesBulkUpdate?: { issues?: DBIssue[] } })?.issuesBulkUpdate?.issues ??
              [];
            for (const issue of updated) {
              issueStore.applySyncAction('U', issue.id, issue);
            }
          },
        },
      );
    },
    [issueStore, txQueue, t],
  );
}
