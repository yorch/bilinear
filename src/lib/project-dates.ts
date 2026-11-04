/**
 * Project / initiative / milestone dates are calendar dates, but the store
 * holds whatever the server serialised: `2026-10-01T00:00:00.000Z` for rows
 * created through the API, `2026-10-01` for ones typed into a date input.
 * Views must never print the raw value or feed it to `split('-')`.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` prefix of a stored date, or null when it isn't one. */
export function toDateOnly(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = DATE_ONLY.exec(value);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/**
 * Formats a stored calendar date in the viewer's locale. Rendered in UTC so a
 * midnight-UTC timestamp doesn't slip to the previous day west of Greenwich.
 */
export function formatDateOnly(
  value: string | null | undefined,
  intlLocale: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const dateOnly = toDateOnly(value);
  if (!dateOnly) {
    return '';
  }
  return new Date(`${dateOnly}T00:00:00Z`).toLocaleDateString(intlLocale, {
    ...options,
    timeZone: 'UTC',
  });
}

/** True when either end is unset, or the target is on/after the start. */
export function isValidProjectRange(
  start: string | null | undefined,
  target: string | null | undefined,
): boolean {
  const a = toDateOnly(start);
  const b = toDateOnly(target);
  return !(a && b) || b >= a;
}
