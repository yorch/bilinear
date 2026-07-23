'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { ISSUE_UPDATE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Injectable override for where optimistic issue state lives, so callers that
 * don't render from the shared `issueStore` can still get the offline-queue/
 * rollback/reconcile machinery below instead of hand-rolling their own copy.
 * All three are optional and default to the `issueStore`-backed behavior this
 * hook has always had — every existing `useIssueUpdate()` call site (team
 * page, my-issues, backlog, custom views, command palette) passes no
 * argument at all, so they're byte-for-byte unaffected by this type existing.
 *
 * Only the standalone issue route (`issue/[id]/page.tsx`) supplies overrides
 * today: it renders from a local `useState` copy of the issue (it can show
 * an issue the store hasn't hydrated yet), not the store, so the default
 * `issueStore.optimisticUpdate`/`applySyncAction` calls would silently write
 * to state the page doesn't read from.
 */
export interface IssueUpdateAdapter {
  /** Apply a patch — or, on rollback, a prior snapshot — optimistically. */
  apply: (id: string, patch: unknown) => void;
  /** Reconcile local state with the authoritative row the mutation returned. */
  reconcile: (id: string, updated: Record<string, unknown>) => void;
  /** Snapshot the pre-update value for `id`, used to roll back on mutation failure. `undefined`/`null` skips rollback (nothing to restore). */
  snapshot: (id: string) => unknown;
}

/**
 * Optimistic issue field update shared by the issue surfaces (team page,
 * my-issues, backlog, custom views, command palette, and — via `overrides` —
 * the standalone issue route): apply the patch immediately, enqueue the
 * mutation, roll back + toast on failure, and reconcile with the server row
 * on success.
 */
export function useIssueUpdate(
  overrides?: Partial<IssueUpdateAdapter>,
): (id: string, patch: Record<string, unknown>) => void {
  const { issueStore } = useStore();
  const t = useTranslations();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  const defaultSnapshot = useCallback((id: string) => issueStore.findById(id), [issueStore]);
  const defaultApply = useCallback(
    (id: string, patch: unknown) => {
      issueStore.optimisticUpdate(id, patch as Partial<DBIssue>);
    },
    [issueStore],
  );
  const defaultReconcile = useCallback(
    (id: string, updated: Record<string, unknown>) => {
      issueStore.applySyncAction('U', id, updated as unknown as DBIssue);
    },
    [issueStore],
  );

  const snapshot = overrides?.snapshot ?? defaultSnapshot;
  const apply = overrides?.apply ?? defaultApply;
  const reconcile = overrides?.reconcile ?? defaultReconcile;

  return useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const prior = snapshot(id);
      apply(id, patch);

      txQueue.enqueue(
        ISSUE_UPDATE_MUTATION,
        { id, input: patch },
        {
          onError: err => {
            toast.error(getErrorMessage(err, t('issues.updateFailed')));
            if (prior) {
              apply(id, prior);
            }
          },
          onSuccess: data => {
            const updated = (data as { issueUpdate?: { issue?: Record<string, unknown> } })
              ?.issueUpdate?.issue;
            if (updated) {
              reconcile(id, updated);
            }
          },
        },
      );
    },
    [apply, snapshot, reconcile, txQueue, t],
  );
}
