'use client';

import { useCallback, useMemo } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssueReminder } from '@/lib/db';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';
import { isReminderPending } from '@/stores/issue-reminder-store';

export const ISSUE_REMINDER_SET_MUTATION = `
  mutation IssueReminderSet($issueId: ID!, $remindAt: DateTime!) {
    issueReminderSet(issueId: $issueId, remindAt: $remindAt) {
      success
      lastSyncId
      reminder { id issueId organizationId userId remindAt createdAt updatedAt }
    }
  }
`;

export const ISSUE_REMINDER_CLEAR_MUTATION = `
  mutation IssueReminderClear($issueId: ID!) {
    issueReminderClear(issueId: $issueId) { success lastSyncId }
  }
`;

/**
 * The viewer's issue reminders. They are an ordinary synced pool (bootstrap,
 * delta and WebSocket fill `issueReminderStore`), so there is nothing to fetch
 * here. Writes go through the offline-capable `TransactionQueue` exactly like
 * issue updates: the store changes first (the chip appears at once, even
 * offline), the mutation drains when it can, and a permanent failure rolls the
 * store back with a toast. Callers must be `observer()`s: `reminderFor` is a
 * live store read.
 */
export function useIssueReminders() {
  const { issueReminderStore, issueStore, userStore } = useStore();
  const t = useTranslations();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  const setReminder = useCallback(
    (issueId: string, remindAt: Date): void => {
      const prev = issueReminderStore.setOptimistic(issueId, remindAt.toISOString(), {
        organizationId: issueStore.findById(issueId)?.organizationId ?? '',
        userId: userStore.currentUserId ?? '',
      });
      txQueue.enqueue(
        ISSUE_REMINDER_SET_MUTATION,
        { issueId, remindAt: remindAt.toISOString() },
        {
          onError: () => {
            // Localized text only: the server's English reason (past time, over
            // a year) is already prevented by the picker's own validation.
            toast.error(t('reminders.setFailed'));
            if (prev) {
              issueReminderStore.applySyncAction('U', prev.id, prev);
            } else {
              issueReminderStore.clearForIssue(issueId);
            }
          },
          onSuccess: data => {
            const confirmed = (data as { issueReminderSet?: { reminder?: DBIssueReminder } })
              ?.issueReminderSet?.reminder;
            if (confirmed) {
              issueReminderStore.applySyncAction('U', confirmed.id, confirmed);
            }
          },
        },
      );
    },
    [issueReminderStore, issueStore, t, txQueue, userStore],
  );

  const clearReminder = useCallback(
    (issueId: string): void => {
      const prev = issueReminderStore.clearForIssue(issueId);
      txQueue.enqueue(
        ISSUE_REMINDER_CLEAR_MUTATION,
        { issueId },
        {
          onError: () => {
            toast.error(t('reminders.clearFailed'));
            if (prev) {
              issueReminderStore.applySyncAction('U', prev.id, prev);
            }
          },
          onSuccess: () => {
            toast.success(t('reminders.cleared'));
          },
        },
      );
    },
    [issueReminderStore, t, txQueue],
  );

  /** The viewer's still-pending reminder on `issueId`, or null (none, or its time has passed). */
  const reminderFor = useCallback(
    (issueId: string): DBIssueReminder | null => {
      const row = issueReminderStore.forIssue(issueId);
      return row && isReminderPending(row) ? row : null;
    },
    [issueReminderStore],
  );

  return { clearReminder, reminderFor, setReminder };
}
