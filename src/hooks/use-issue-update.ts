'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { ISSUE_UPDATE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';

/**
 * Optimistic issue field update shared by the issue surfaces (team page,
 * my-issues, backlog, custom views, command palette): apply the patch
 * immediately, enqueue the mutation, roll back + toast on failure, and
 * reconcile with the server row on success.
 */
export function useIssueUpdate(): (id: string, patch: Record<string, unknown>) => void {
  const { issueStore } = useStore();
  const t = useTranslations();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  return useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const snapshot = issueStore.findById(id);
      issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);

      txQueue.enqueue(
        ISSUE_UPDATE_MUTATION,
        { id, input: patch },
        {
          onError: err => {
            toast.error(err instanceof Error ? err.message : t('issues.updateFailed'));
            if (snapshot) {
              issueStore.optimisticUpdate(id, snapshot);
            }
          },
          onSuccess: data => {
            const updated = (data as { issueUpdate?: { issue?: DBIssue } })?.issueUpdate?.issue;
            if (updated) {
              issueStore.applySyncAction('U', id, updated);
            }
          },
        },
      );
    },
    [issueStore, txQueue, t],
  );
}
