'use client';

import { Bell, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { useIssueReminders } from '@/hooks/use-issue-reminders';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET_SQUARE } from '@/lib/utils';

/** setTimeout stores its delay in a signed 32-bit int; longer waits fire immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * "Reminder: Nov 25, 9:00 AM" with a clear button, shown on the issue page
 * while the viewer has a pending reminder. It hides itself the moment the
 * reminder's time passes (a timer re-renders it) rather than waiting for the
 * sweep's delete to arrive, and the delete then removes the row for good.
 */
export const IssueReminderChip = observer(function IssueReminderChip({
  issueId,
}: {
  issueId: string;
}) {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const { clearReminder, reminderFor } = useIssueReminders();
  const [, setTick] = useState(0);
  const reminder = reminderFor(issueId);
  const remindAt = reminder?.remindAt;

  useEffect(() => {
    if (!remindAt) {
      return;
    }
    const wait = new Date(remindAt).getTime() - Date.now();
    if (wait <= 0) {
      return;
    }
    const timer = setTimeout(() => setTick(n => n + 1), Math.min(wait + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [remindAt]);

  if (!reminder) {
    return null;
  }
  const when = formatDateTime(reminder.remindAt, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  });

  return (
    <div>
      <Badge
        className="items-center"
        data-testid="issue-reminder-chip"
        title={t('reminders.chipTitle', { when })}
        tone="brand"
      >
        <Bell aria-hidden="true" className="h-3 w-3" />
        <span>{t('reminders.chipLabel', { when })}</span>
        <button
          aria-label={`${t('reminders.clear')}: ${when}`}
          className={cn(
            'inline-flex items-center justify-center rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            TOUCH_TARGET_SQUARE,
          )}
          data-testid="issue-reminder-clear"
          onClick={() => clearReminder(issueId)}
          title={t('reminders.clear')}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      </Badge>
    </div>
  );
});
