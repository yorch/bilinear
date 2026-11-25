'use client';

import { observer } from 'mobx-react-lite';
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
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

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The time prefilled once a day is chosen: 09:00, except that today after 09:00
 * gets the next quarter hour — otherwise picking "today" would open on a time
 * that has already passed and flag a past-time error for a value the user never
 * entered.
 */
function defaultTimeFor(day: string, now: Date = new Date()): string {
  const morning = '09:00';
  if (day !== reminderInputMin(now).slice(0, 10)) {
    return morning;
  }
  const next = new Date(now);
  next.setMinutes(Math.floor(next.getMinutes() / 15) * 15 + 15, 0, 0);
  if (next.getDate() !== now.getDate()) {
    return '23:59';
  }
  const value = `${pad2(next.getHours())}:${pad2(next.getMinutes())}`;
  return value > morning ? value : morning;
}

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
  const timeId = useId();
  const { formatDateTime } = useFormatters();
  const { clearReminder, reminderFor, setReminder } = useIssueReminders();
  const existing = reminderFor(issueId);
  // Day and time are separate state, combined only for validation and submit:
  // emptying the time field must not forget the chosen day. `time === null`
  // means "untouched", so the default follows whichever day is picked.
  const [initial] = useState(() =>
    existing ? toReminderInputValue(new Date(existing.remindAt)) : '',
  );
  const [day, setDay] = useState(initial.slice(0, 10));
  const [time, setTime] = useState<string | null>(initial ? initial.slice(11, 16) : null);
  const customTime = time ?? defaultTimeFor(day);
  const custom = day && customTime ? `${day}T${customTime}` : '';
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
      <form
        className="flex flex-col gap-1.5 px-3 pt-1.5"
        noValidate
        onKeyDown={onKeyDown}
        onSubmit={submit}
      >
        <p className="text-xs text-muted-foreground">{t('reminders.customLabel')}</p>
        <Calendar
          className="-mx-2 w-auto"
          max={reminderInputMax().slice(0, 10)}
          min={reminderInputMin().slice(0, 10)}
          onChange={date => {
            setDay(date);
            setTouched(true);
          }}
          value={day}
        />
        {/* Footer stays pinned to the bottom of the scrolling menu, so the time
            and "Set reminder" are reachable however much of the Calendar fits. */}
        <div className="sticky bottom-0 -mx-3 flex flex-col gap-1.5 border-t border-border bg-card px-3 pb-2 pt-2">
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor={`${timeId}-time`}
          >
            {t('calendar.time')}
            <Input
              aria-describedby="reminder-custom-note"
              aria-invalid={error ? true : undefined}
              className="w-auto px-2 py-1"
              data-autofocus
              id={`${timeId}-time`}
              onChange={e => {
                setTime(e.target.value);
                // A time typed before any day means today.
                if (!day) {
                  setDay(reminderInputMin().slice(0, 10));
                }
                setTouched(true);
              }}
              type="time"
              value={customTime}
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
        </div>
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
