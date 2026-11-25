'use client';

import { observer } from 'mobx-react-lite';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { POPOVER_ITEM_CLASS } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useIssueReminders } from '@/hooks/use-issue-reminders';
import { useTranslations } from '@/hooks/use-translations';
import { toast } from '@/lib/toast';
import {
  getReminderPresets,
  type ReminderInputResult,
  reminderInputMax,
  reminderInputMin,
  resolveReminderInput,
  toReminderInputValue,
} from './reminder-presets';

interface IssueReminderPanelProps {
  issueId: string;
  onClose: () => void;
}

/**
 * Body of the "Remind me…" submenu: presets, a custom date-time, and — when a
 * reminder is already set — a clear action. Rendered inside the issue context
 * menu, which supplies the back header.
 *
 * The custom picker commits only on an explicit "Set reminder" (or Enter), is
 * prefilled with the current reminder when there is one, and Escape abandons
 * it. A half-typed `datetime-local` value is complete the moment its last
 * segment is filled, so committing on change would set a reminder the user
 * was still typing.
 */
export const IssueReminderPanel = observer(function IssueReminderPanel({
  issueId,
  onClose,
}: IssueReminderPanelProps) {
  const t = useTranslations();
  const { formatDateTime } = useFormatters();
  const { clearReminder, reminderFor, setReminder } = useIssueReminders();
  const existing = reminderFor(issueId);
  const [custom, setCustom] = useState(() =>
    existing ? toReminderInputValue(new Date(existing.remindAt)) : '',
  );
  const [touched, setTouched] = useState(false);
  const presets = getReminderPresets();
  const when = (d: Date) =>
    formatDateTime(d, { day: 'numeric', hour: 'numeric', minute: '2-digit', month: 'short' });

  const result: ReminderInputResult | null = custom ? resolveReminderInput(custom) : null;
  const error =
    result && !result.ok
      ? t(
          result.reason === 'past'
            ? 'reminders.pastTime'
            : result.reason === 'tooFar'
              ? 'reminders.tooFar'
              : 'reminders.invalidTime',
        )
      : touched && !custom
        ? t('reminders.invalidTime')
        : null;

  const choose = (at: Date) => {
    onClose();
    setReminder(issueId, at);
    toast.success(t('reminders.set', { when: when(at) }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (result?.ok) {
      choose(result.at);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Claim it: one Escape abandons the picker and closes exactly this surface.
      e.preventDefault();
      e.stopPropagation();
      onClose();
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
          onClick={() => choose(preset.at)}
          type="button"
        >
          <span className="flex-1 text-left">{t(labelKey[preset.key])}</span>
          <span className="text-xs text-muted-foreground">{when(preset.at)}</span>
        </button>
      ))}
      <form className="flex flex-col gap-1.5 px-3 py-1.5" noValidate onSubmit={submit}>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('reminders.customLabel')}
          <input
            aria-describedby="reminder-custom-note"
            aria-invalid={error ? true : undefined}
            className="rounded border border-input bg-background px-2 py-1 text-sm text-foreground"
            data-autofocus
            max={reminderInputMax()}
            min={reminderInputMin()}
            onChange={e => {
              setCustom(e.target.value);
              setTouched(true);
            }}
            onKeyDown={onKeyDown}
            type="datetime-local"
            value={custom}
          />
        </label>
        <p
          aria-live="polite"
          className={
            error
              ? 'text-xs text-danger-subtle-foreground'
              : 'text-xs text-warning-subtle-foreground'
          }
          id="reminder-custom-note"
        >
          {error ??
            (result?.ok && result.shifted ? t('reminders.shifted', { when: when(result.at) }) : '')}
        </p>
        <Button disabled={!result?.ok} size="sm" type="submit">
          {t('reminders.setCustom')}
        </Button>
      </form>
      {existing && (
        <>
          <div className="my-1 border-t border-border" />
          <button
            className={POPOVER_ITEM_CLASS}
            onClick={() => {
              onClose();
              clearReminder(issueId);
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
