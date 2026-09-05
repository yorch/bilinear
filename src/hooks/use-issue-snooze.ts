'use client';

import { useCallback } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

export const ISSUE_SNOOZE_MUTATION = `
  mutation IssueSnooze($id: ID!, $until: DateTime!) {
    issueSnooze(id: $id, until: $until) {
      success
      lastSyncId
      issue { id snoozedUntilAt snoozedById }
    }
  }
`;

export const ISSUE_UNSNOOZE_MUTATION = `
  mutation IssueUnsnooze($id: ID!) {
    issueUnsnooze(id: $id) {
      success
      lastSyncId
      issue { id snoozedUntilAt snoozedById }
    }
  }
`;

/**
 * Snooze / unsnooze an issue: patch the store optimistically, fire the
 * mutation, roll back and toast on failure. Snoozing is a bespoke mutation
 * (not `issueUpdate`), so this cannot ride `useIssueUpdate`'s queue.
 */
export function useIssueSnooze() {
  const { issueStore } = useStore();
  const t = useTranslations();

  const snooze = useCallback(
    async (id: string, until: Date) => {
      const prev = issueStore.findById(id)?.snoozedUntilAt ?? null;
      issueStore.optimisticUpdate(id, { snoozedUntilAt: until.toISOString() });
      try {
        await gqlMutate(ISSUE_SNOOZE_MUTATION, { id, until: until.toISOString() });
        toast.success(t('issues.snooze.snoozed'));
      } catch (err) {
        issueStore.optimisticUpdate(id, { snoozedUntilAt: prev });
        toast.error(getErrorMessage(err, t('issues.snooze.snoozeFailed')));
      }
    },
    [issueStore, t],
  );

  const unsnooze = useCallback(
    async (id: string) => {
      const prev = issueStore.findById(id)?.snoozedUntilAt ?? null;
      issueStore.optimisticUpdate(id, { snoozedUntilAt: null });
      try {
        await gqlMutate(ISSUE_UNSNOOZE_MUTATION, { id });
        toast.success(t('issues.snooze.unsnoozed'));
      } catch (err) {
        issueStore.optimisticUpdate(id, { snoozedUntilAt: prev });
        toast.error(getErrorMessage(err, t('issues.snooze.unsnoozeFailed')));
      }
    },
    [issueStore, t],
  );

  return { snooze, unsnooze };
}
