/**
 * Pure date helpers for the "Remind me…" presets. Free of React and i18n so the
 * arithmetic can be tested against fixed clocks. "Tomorrow" and "next week"
 * reuse the snooze presets so the two features agree on what morning means.
 */
import { snoozeUntilNextWeek, snoozeUntilTomorrow } from './snooze-presets';

export type ReminderPresetKey = 'laterToday' | 'tomorrow' | 'nextWeek';

export interface ReminderPreset {
  at: Date;
  key: ReminderPresetKey;
}

/** How far ahead "later today" looks before rounding up to the next full hour. */
export const LATER_TODAY_LEAD_HOURS = 3;

/**
 * Three hours from now, rounded up to the hour. Null when that lands on a later
 * calendar day — then "later today" no longer exists and "tomorrow" takes over.
 */
export function remindLaterToday(now: Date = new Date()): Date | null {
  const d = new Date(now);
  d.setHours(d.getHours() + LATER_TODAY_LEAD_HOURS, 0, 0, 0);
  if (d.getTime() - now.getTime() < LATER_TODAY_LEAD_HOURS * 3_600_000) {
    d.setHours(d.getHours() + 1);
  }
  return d.toDateString() === now.toDateString() ? d : null;
}

export function getReminderPresets(now: Date = new Date()): ReminderPreset[] {
  const later = remindLaterToday(now);
  return [
    ...(later ? [{ at: later, key: 'laterToday' as const }] : []),
    { at: snoozeUntilTomorrow(now), key: 'tomorrow' },
    { at: snoozeUntilNextWeek(now), key: 'nextWeek' },
  ];
}

/**
 * Parse a `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`, local
 * time). Null when malformed or not strictly in the future.
 */
export function parseReminderInput(value: string, now: Date = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) {
    return null;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) {
    return null;
  }
  return d;
}

/** The earliest value the datetime-local picker should offer, as `YYYY-MM-DDTHH:mm`. */
export function reminderInputMin(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
