/**
 * CSV generation + browser download helpers.
 *
 * Kept dependency-free so a unit test can import it without a DOM shim.
 * Only `downloadCsv` touches the DOM; everything else is pure.
 */

/**
 * Format a single cell. Quotes any value containing comma, double-quote, or
 * newline per RFC 4180, and doubles internal quotes. Accepts any scalar —
 * arrays are joined with ", " before quoting.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = Array.isArray(value)
    ? value.map(v => (v == null ? '' : String(v))).join(', ')
    : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Build a CSV string from a header row plus rows of matching arity. */
export function rowsToCsv(headers: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines: string[] = [];
  lines.push(headers.map(csvCell).join(','));
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  // Leading UTF-8 BOM so Excel opens multibyte characters correctly.
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * Trigger a browser download for the given CSV string. Caller supplies a
 * stem like "team-ENG-issues"; the helper adds the .csv extension and a
 * UTC date stamp so successive exports don't collide.
 */
export function downloadCsv(stem: string, csv: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  const name = `${stem}-${today}.csv`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
