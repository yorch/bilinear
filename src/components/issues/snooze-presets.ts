/**
 * Pure date helpers for the issue snooze menu. Kept free of React and i18n so
 * the arithmetic can be unit-tested against fixed clocks.
 */

export type SnoozePresetKey = 'tomorrow' | 'nextWeek';

export interface SnoozePreset {
  key: SnoozePresetKey;
  until: Date;
}

/** Local wake-up hour for every preset — mornings, like the notification inbox. */
export const SNOOZE_WAKE_HOUR = 9;

function atWakeHour(date: Date): Date {
  const d = new Date(date);
  d.setHours(SNOOZE_WAKE_HOUR, 0, 0, 0);
  return d;
}

/** Tomorrow at the wake hour, in local time. */
export function snoozeUntilTomorrow(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return atWakeHour(d);
}

/**
 * Next Monday at the wake hour. From a Monday this is the *following* Monday
 * (seven days out), never today, so "next week" always moves the issue forward.
 */
export function snoozeUntilNextWeek(now: Date = new Date()): Date {
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sunday … 6 = Saturday
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  return atWakeHour(d);
}

export function getSnoozePresets(now: Date = new Date()): SnoozePreset[] {
  return [
    { key: 'tomorrow', until: snoozeUntilTomorrow(now) },
    { key: 'nextWeek', until: snoozeUntilNextWeek(now) },
  ];
}

/**
 * Turn a `<input type="date">` value (`YYYY-MM-DD`, local calendar date) into
 * the wake-up instant for that day. Returns null for an empty or malformed
 * value, and for a day that has already passed — snoozing into the past is a
 * no-op the server would immediately wake.
 */
export function snoozeUntilDate(value: string, now: Date = new Date()): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const d = atWakeHour(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(d.getTime()) || d.getTime() <= now.getTime()) {
    return null;
  }
  return d;
}

/** True while `snoozedUntilAt` is set and still in the future. */
export function isIssueSnoozed(
  snoozedUntilAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!snoozedUntilAt) {
    return false;
  }
  const until = new Date(snoozedUntilAt).getTime();
  return !Number.isNaN(until) && until > now.getTime();
}
