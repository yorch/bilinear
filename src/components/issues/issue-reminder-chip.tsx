'use client';

import { Bell, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { useIssueReminders } from '@/hooks/use-issue-reminders';
import { useTranslations } from '@/hooks/use-translations';

/**
 * "Reminder · Tomorrow, 9:00 AM" with a clear button, shown on the issue page
 * while the viewer has a pending reminder. Renders nothing otherwise — and for
 * a reminder whose time has passed but whose fire sweep hasn't run yet.
 */
export const IssueReminderChip = observer(function IssueReminderChip({
  issueId,
}: {
  issueId: string;
}) {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const { clearReminder, reminderFor } = useIssueReminders();
  const reminder = reminderFor(issueId);
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
        <span>{when}</span>
        <button
          aria-label={t('reminders.clear')}
          className="rounded-full p-0.5 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="issue-reminder-clear"
          onClick={() => void clearReminder(issueId)}
          title={t('reminders.clear')}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      </Badge>
    </div>
  );
});
