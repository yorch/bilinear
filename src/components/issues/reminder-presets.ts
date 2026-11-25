/**
 * Pure date helpers for the "Remind me…" presets. Free of React and i18n so the
 * arithmetic can be tested against fixed clocks in any timezone.
 *
 * Everything is local wall-clock time. Calendar steps use `setDate`, never
 * "+24h", so a day with a DST change still lands on the same wall-clock hour.
 */

export type ReminderPresetKey = 'laterToday' | 'tomorrow' | 'nextWeek';

export interface ReminderPreset {
  at: Date;
  key: ReminderPresetKey;
}

/** Local hour every "morning" preset fires at. */
export const REMINDER_MORNING_HOUR = 9;
/** "Later today" never lands after this local hour (a reminder at midnight helps nobody). */
export const REMINDER_LATEST_TODAY_HOUR = 18;
/** How far ahead "later today" looks. */
export const LATER_TODAY_LEAD_HOURS = 3;
/** Mirrors the server's one-year horizon (`REMINDER_MAX_HORIZON_MS`). */
export const REMINDER_MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

function atHour(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** The next calendar day at 09:00. */
export function remindTomorrow(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return atHour(d, REMINDER_MORNING_HOUR);
}

/**
 * The next Monday at 09:00 that is strictly after "tomorrow" — so on a Sunday
 * (tomorrow IS Monday) it is the Monday after, and the two presets never
 * collapse into the same instant.
 */
export function remindNextWeek(now: Date = new Date()): Date {
  const tomorrow = remindTomorrow(now);
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sunday … 6 = Saturday
  d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  const monday = atHour(d, REMINDER_MORNING_HOUR);
  if (monday.getTime() <= tomorrow.getTime()) {
    monday.setDate(monday.getDate() + 7);
    return atHour(monday, REMINDER_MORNING_HOUR);
  }
  return monday;
}

/**
 * Three hours from now, rounded up to the hour, and no later than 18:00 — so
 * a reminder asked for at 17:30 is 18:00, not 21:00. In the small hours (when
 * +3h is still before the morning) it is 09:00 today, which keeps "this
 * morning" reachable without the custom picker. Null once 18:00 has passed:
 * then "later today" no longer exists and "tomorrow" takes over.
 */
export function remindLaterToday(now: Date = new Date()): Date | null {
  const d = new Date(now);
  d.setHours(d.getHours() + LATER_TODAY_LEAD_HOURS, 0, 0, 0);
  if (d.getTime() - now.getTime() < LATER_TODAY_LEAD_HOURS * 3_600_000) {
    d.setHours(d.getHours() + 1);
  }
  // Same calendar day only: past midnight is "tomorrow", not "later today".
  if (d.toDateString() !== now.toDateString()) {
    return null;
  }
  const morning = atHour(now, REMINDER_MORNING_HOUR);
  const target = d.getTime() < morning.getTime() ? morning : d;
  return clampLaterToday(now, target);
}

function clampLaterToday(now: Date, target: Date): Date | null {
  const latest = atHour(now, REMINDER_LATEST_TODAY_HOUR);
  const at = target.getTime() > latest.getTime() ? latest : target;
  return at.getTime() > now.getTime() ? at : null;
}

export function getReminderPresets(now: Date = new Date()): ReminderPreset[] {
  const later = remindLaterToday(now);
  return [
    ...(later ? [{ at: later, key: 'laterToday' as const }] : []),
    { at: remindTomorrow(now), key: 'tomorrow' },
    { at: remindNextWeek(now), key: 'nextWeek' },
  ];
}

export type ReminderInputResult =
  | { ok: true; at: Date; shifted: boolean }
  | { ok: false; reason: 'invalid' | 'past' | 'tooFar' };

/**
 * Parse a `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`, local
 * time). `shifted` is true when the typed wall-clock time does not exist (it
 * falls in a spring-forward gap) and the runtime moved it, e.g. 02:30 → 03:30,
 * so the UI can say so instead of silently setting a different time.
 */
export function resolveReminderInput(value: string, now: Date = new Date()): ReminderInputResult {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) {
    return { ok: false, reason: 'invalid' };
  }
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const d = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, reason: 'invalid' };
  }
  if (d.getTime() <= now.getTime()) {
    return { ok: false, reason: 'past' };
  }
  if (d.getTime() > now.getTime() + REMINDER_MAX_HORIZON_MS) {
    return { ok: false, reason: 'tooFar' };
  }
  const shifted = d.getHours() !== hour || d.getMinutes() !== minute;
  return { at: d, ok: true, shifted };
}

/** Null when malformed, not strictly in the future, or beyond the horizon. */
export function parseReminderInput(value: string, now: Date = new Date()): Date | null {
  const r = resolveReminderInput(value, now);
  return r.ok ? r.at : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in local time — the format `datetime-local` reads and writes. */
export function toReminderInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The earliest value the datetime-local picker should offer. */
export function reminderInputMin(now: Date = new Date()): string {
  return toReminderInputValue(now);
}

/** The latest value the picker should offer (the server's one-year horizon). */
export function reminderInputMax(now: Date = new Date()): string {
  return toReminderInputValue(new Date(now.getTime() + REMINDER_MAX_HORIZON_MS));
}
