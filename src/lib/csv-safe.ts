/**
 * Neutralise spreadsheet formula injection for exported text cells: names and
 * free text are user-controlled, and a cell starting with = + - @ (or a tab or
 * carriage return, which Excel also treats as a formula lead-in) runs as a
 * formula when the CSV is opened. Numbers must not go through this.
 */
export function csvSafeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
