/**
 * Parse a stored calendar date into a local-midnight `Date`.
 *
 * Accepts both shapes the app holds: a date-only string (`2026-10-23`) and a
 * full ISO timestamp (`2026-10-23T00:00:00.000Z`, which is what the issue
 * store and the GraphQL `DateTime` scalar produce). Only the calendar-date
 * prefix is read, so the result is the day the user sees on a label rather
 * than a UTC instant shifted by the viewer's offset.
 *
 * Returns null for empty/invalid input and for impossible dates (`2026-02-31`).
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(value.trim());
  if (!match) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  // Reject roll-over (Feb 31 -> Mar 3).
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}
