import { addDays, format } from 'date-fns';

export type DueDatePresetKey = 'today' | 'tomorrow' | 'endOfWeek' | 'nextWeek';

export interface DueDatePreset {
  /** Local calendar date, `YYYY-MM-DD` — the same shape `<input type="date">` and the API use. */
  date: string;
  key: DueDatePresetKey;
}

const toDateValue = (d: Date): string => format(d, 'yyyy-MM-dd');

/**
 * Quick due dates for the picker. Pure, against an injectable clock.
 *
 * - `endOfWeek` is this week's Friday; from Friday onward (when "this week" is
 *   already over or is today) it is the following Friday, so it never duplicates
 *   Today and always lies ahead.
 * - `nextWeek` is the coming Monday, seven days out when today is a Monday.
 * - A preset whose date equals an earlier one is dropped (Thursday's Friday and
 *   Sunday's Monday are both "tomorrow"), so the list never shows two chips for
 *   the same day.
 */
export function getDueDatePresets(now: Date = new Date()): DueDatePreset[] {
  const day = now.getDay(); // 0 = Sunday … 6 = Saturday
  const daysUntilFriday = day < 5 ? 5 - day : 12 - day;
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7 || 7;
  const all: DueDatePreset[] = [
    { date: toDateValue(now), key: 'today' },
    { date: toDateValue(addDays(now, 1)), key: 'tomorrow' },
    { date: toDateValue(addDays(now, daysUntilFriday)), key: 'endOfWeek' },
    { date: toDateValue(addDays(now, daysUntilMonday)), key: 'nextWeek' },
  ];
  const seen = new Set<string>();
  return all.filter(p => {
    if (seen.has(p.date)) {
      return false;
    }
    seen.add(p.date);
    return true;
  });
}
