'use client';

import { observer } from 'mobx-react-lite';
import { POPOVER_ITEM_CLASS } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useIssueReminders } from '@/hooks/use-issue-reminders';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import { getReminderPresets, parseReminderInput, reminderInputMin } from './reminder-presets';

interface IssueReminderPanelProps {
  issueId: string;
  onClose: () => void;
}

/**
 * Body of the "Remind me…" submenu: presets, a custom date-time, and — when a
 * reminder is already set — a clear action. Rendered inside the issue context
 * menu, which supplies the back header.
 */
export const IssueReminderPanel = observer(function IssueReminderPanel({
  issueId,
  onClose,
}: IssueReminderPanelProps) {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const { clearReminder, reminderFor, setReminder } = useIssueReminders();
  const existing = reminderFor(issueId);
  const presets = getReminderPresets();
  const when = (d: Date) =>
    formatDateTime(d, { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short' });

  const choose = async (at: Date) => {
    onClose();
    if (await setReminder(issueId, at)) {
      toast.success(t('reminders.set', { when: when(at) }));
    }
  };

  const labelKey = {
    laterToday: 'reminders.laterToday',
    nextWeek: 'reminders.nextWeek',
    tomorrow: 'reminders.tomorrow',
  } as const;

  return (
    <>
      {presets.map(preset => (
        <button
          className={POPOVER_ITEM_CLASS}
          key={preset.key}
          onClick={() => void choose(preset.at)}
          type="button"
        >
          <span className="flex-1 text-left">{t(labelKey[preset.key])}</span>
          <span className="text-xs text-muted-foreground">{when(preset.at)}</span>
        </button>
      ))}
      <label className="flex flex-col gap-1 px-3 py-1.5 text-xs text-muted-foreground">
        {t('reminders.customLabel')}
        <input
          aria-label={t('reminders.customLabel')}
          className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
          min={reminderInputMin()}
          onChange={e => {
            if (!e.target.value) {
              return;
            }
            const at = parseReminderInput(e.target.value);
            if (at) {
              void choose(at);
            } else {
              toast.error(t('reminders.pastTime'));
            }
          }}
          type="datetime-local"
        />
      </label>
      {existing && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            className={POPOVER_ITEM_CLASS}
            onClick={() => {
              onClose();
              void clearReminder(issueId);
            }}
            type="button"
          >
            {t('reminders.clear')}
          </button>
        </>
      )}
    </>
  );
});
