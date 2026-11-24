'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

export const MY_ISSUE_REMINDERS_QUERY = `
  query MyIssueReminders {
    myIssueReminders { id issueId remindAt }
  }
`;

export const ISSUE_REMINDER_SET_MUTATION = `
  mutation IssueReminderSet($issueId: ID!, $remindAt: DateTime!) {
    issueReminderSet(issueId: $issueId, remindAt: $remindAt) {
      success
      reminder { id issueId remindAt }
    }
  }
`;

export const ISSUE_REMINDER_CLEAR_MUTATION = `
  mutation IssueReminderClear($issueId: ID!) {
    issueReminderClear(issueId: $issueId) { success }
  }
`;

/** Re-fetch at most this often when consumers mount; mutations patch the store directly. */
const STALE_AFTER_MS = 60_000;

/**
 * The viewer's issue reminders. Reminders are private and not delivered through
 * sync, so the first consumer to mount loads them with `myIssueReminders` and
 * later ones refresh when the copy is older than a minute. Callers must be
 * `observer()`s: `reminderFor` is a live store read.
 */
export function useIssueReminders() {
  const { issueReminderStore } = useStore();
  const t = useTranslations();

  useEffect(() => {
    if (Date.now() - issueReminderStore.fetchedAt < STALE_AFTER_MS) {
      return;
    }
    // Claim the slot first so sibling consumers mounting in the same tick don't all fetch.
    const previous = issueReminderStore.fetchedAt;
    issueReminderStore.setFetchedAt(Date.now());
    gqlQuery<Array<{ id: string; issueId: string; remindAt: string }>>(
      MY_ISSUE_REMINDERS_QUERY,
      {},
      'myIssueReminders',
    )
      .then(rows => issueReminderStore.replaceAll(rows))
      .catch(() => {
        // Non-fatal: chips just stay hidden. Let the next mount retry.
        issueReminderStore.setFetchedAt(previous);
      });
  }, [issueReminderStore]);

  const setReminder = useCallback(
    async (issueId: string, remindAt: Date): Promise<boolean> => {
      try {
        const data = await gqlMutate(ISSUE_REMINDER_SET_MUTATION, {
          issueId,
          remindAt: remindAt.toISOString(),
        });
        const reminder = (
          data.issueReminderSet as { reminder?: { id: string; issueId: string; remindAt: string } }
        ).reminder;
        if (reminder) {
          issueReminderStore.upsert(reminder);
        }
        return true;
      } catch (err) {
        toast.error(getErrorMessage(err, t('reminders.setFailed')));
        return false;
      }
    },
    [issueReminderStore, t],
  );

  const clearReminder = useCallback(
    async (issueId: string): Promise<boolean> => {
      const prev = issueReminderStore.forIssue(issueId);
      issueReminderStore.remove(issueId);
      try {
        await gqlMutate(ISSUE_REMINDER_CLEAR_MUTATION, { issueId });
        toast.success(t('reminders.cleared'));
        return true;
      } catch (err) {
        if (prev) {
          issueReminderStore.upsert(prev);
        }
        toast.error(getErrorMessage(err, t('reminders.clearFailed')));
        return false;
      }
    },
    [issueReminderStore, t],
  );

  const reminderFor = useCallback(
    (issueId: string) => issueReminderStore.forIssue(issueId),
    [issueReminderStore],
  );

  return { clearReminder, reminderFor, setReminder };
}
