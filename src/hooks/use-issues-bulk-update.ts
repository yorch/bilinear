'use client';

import { useCallback, useMemo } from 'react';
import { droppedLabelNamesOf } from '@/hooks/use-issue-update';
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
  const { issueStore, teamStore, workflowStateStore } = useStore();
  const t = useTranslations();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  // What the server will do to a row that changes team, applied optimistically
  // so the row is never shown in the new team with the old team's state/cycle:
  // same-named state, else same type, else the team default; cycle cleared.
  const teamMovePatch = useCallback(
    (issue: DBIssue | null, targetTeamId: string): Partial<DBIssue> => {
      const patch: Partial<DBIssue> = { cycleId: null };
      if (!issue) {
        return patch;
      }
      const current = workflowStateStore.findById(issue.stateId);
      const candidates = workflowStateStore.findByTeamId(targetTeamId);
      const match =
        candidates.find(c => c.name === current?.name) ??
        candidates.find(c => c.type === current?.type);
      const stateId =
        match?.id ?? teamStore.findById(targetTeamId)?.defaultIssueStateId ?? candidates[0]?.id;
      if (stateId) {
        patch.stateId = stateId;
      }
      return patch;
    },
    [teamStore, workflowStateStore],
  );

  return useCallback(
    (ids: string[], patch: Record<string, unknown>) => {
      const snapshots = ids.map(id => ({ id, snapshot: issueStore.findById(id) }));
      const isTeamMove = 'teamId' in patch && typeof patch.teamId === 'string';
      for (const id of ids) {
        issueStore.optimisticUpdate(
          id,
          (isTeamMove
            ? { ...patch, ...teamMovePatch(issueStore.findById(id), patch.teamId as string) }
            : patch) as Partial<DBIssue>,
        );
      }
      // A team move allocates a new number/identifier per issue and remaps its
      // workflow state, which the batch mutation deliberately refuses — so it
      // goes out as one issueUpdate per row (each its own SyncAction).
      if ('teamId' in patch) {
        let settled = 0;
        let failed = 0;
        // Labels scoped to the old team that the server removed, de-duplicated
        // across the batch, and how many issues lost at least one.
        const droppedNames = new Set<string>();
        let droppedIssues = 0;
        // One toast per kind for the whole batch, however many rows were refused
        // or lost labels; shown once the last row has settled.
        const settle = (ok: boolean) => {
          settled++;
          if (!ok) {
            failed++;
          }
          if (settled !== ids.length) {
            return;
          }
          if (failed > 0) {
            toast.error(t('issues.bulkUpdateFailed'));
          }
          if (droppedNames.size > 0) {
            toast.info(
              t('issues.labelsDroppedOnBulkMove', {
                count: droppedNames.size,
                // Its own plural lookup: `count` (labels) picks _one/_other of the sentence,
                // so the issue count must be pre-pluralised or it reads "1 issue(s)".
                issues: t('issues.issuesCount', { count: droppedIssues }),
                labels: [...droppedNames].join(', '),
              }),
            );
          }
        };
        for (const id of ids) {
          txQueue.enqueue(
            ISSUE_UPDATE_MUTATION,
            { id, input: patch },
            {
              onError: () => {
                const snapshot = snapshots.find(s => s.id === id)?.snapshot;
                if (snapshot) {
                  issueStore.optimisticUpdate(id, snapshot);
                }
                settle(false);
              },
              onSuccess: data => {
                const dropped = droppedLabelNamesOf(data);
                if (dropped.length > 0) {
                  droppedIssues++;
                  for (const name of dropped) {
                    droppedNames.add(name);
                  }
                }
                const updated = (data as { issueUpdate?: { issue?: Record<string, unknown> } })
                  ?.issueUpdate?.issue;
                const row = updated ? toIssueSyncRow(updated) : null;
                if (row) {
                  issueStore.applySyncAction('U', id, row);
                }
                settle(true);
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
    [issueStore, teamMovePatch, txQueue, t],
  );
}
