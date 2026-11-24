/**
 * Average cycle time, shared by the workspace and team analytics pages so the
 * same data cannot read "0.0d" on one and "—" on the other.
 *
 * `null`, non-positive and non-finite values are "no measurement" (—). A
 * positive value that would round to "0.0" is shown as "<0.1d" rather than a
 * misleading zero.
 */
export function formatAvgCycleDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days) || days <= 0) {
    return '—';
  }
  const rounded = days.toFixed(1);
  return rounded === '0.0' ? '<0.1d' : `${rounded}d`;
}
