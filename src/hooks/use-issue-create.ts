'use client';

import { runInAction } from 'mobx';
import { useCallback, useMemo } from 'react';
import type { CreateIssueInput } from '@/components/issues/create-issue-modal';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue, DBTeam, DBWorkflowState } from '@/lib/db';
import { ISSUE_CREATE_MUTATION } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Optimistic issue creation shared by the team page and the globally-mounted
 * create modal: insert a temp row immediately (offline support), enqueue the
 * mutation, then swap in the server row — or drop the temp row — on settle.
 */
export function useIssueCreate(
  team: DBTeam | null | undefined,
  states: DBWorkflowState[],
): (input: CreateIssueInput) => Promise<void> {
  const { issueStore } = useStore();
  const t = useTranslations();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  return useCallback(
    async (input: CreateIssueInput) => {
      if (!team) {
        return;
      }

      const tempId = `temp-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const effectiveStateId =
        input.stateId ?? states.find(s => s.type === 'backlog')?.id ?? states[0]?.id ?? '';
      issueStore.applySyncAction('I', tempId, {
        archivedAt: null,
        assigneeId: input.assigneeId ?? null,
        branchName: null,
        canceledAt: null,
        completedAt: null,
        createdAt: now,
        creatorId: null,
        cycleId: null,
        description: input.description ?? null,
        dueDate: input.dueDate ?? null,
        estimate: null,
        id: tempId,
        identifier: `${team.key}-…`,
        labelIds: input.labelIds,
        number: 0,
        organizationId: team.organizationId,
        parentId: null,
        priority: input.priority,
        prioritySortOrder: 0,
        projectId: input.projectId ?? null,
        sortOrder: 0,
        startedAt: null,
        stateId: effectiveStateId,
        teamId: team.id,
        title: input.title,
        trashed: false,
        updatedAt: now,
      } as DBIssue);

      txQueue.enqueue(
        ISSUE_CREATE_MUTATION,
        { input: { ...input, stateId: effectiveStateId || undefined, teamId: team.id } },
        {
          onError: err => {
            console.error('[useIssueCreate] issueCreate failed:', err);
            toast.error(getErrorMessage(err, t('issues.createFailed')));
            runInAction(() => {
              issueStore.pool.delete(tempId);
            });
          },
          onSuccess: data => {
            const created = (data as { issueCreate?: { issue?: DBIssue } })?.issueCreate?.issue;
            runInAction(() => {
              issueStore.pool.delete(tempId);
              if (created) {
                issueStore.applySyncAction('I', created.id, created);
              }
            });
          },
        },
      );
    },
    [team, states, issueStore, txQueue, t],
  );
}
