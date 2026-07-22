/**
 * Clamp a client-supplied `limit` to `[1, max]`, falling back to `dflt` when
 * the caller omitted it entirely. Shared by every GraphQL list resolver that
 * previously hand-rolled its own `Math.min(limit ?? default, MAX)` one-liner
 * (notifications, issue activities, webhook deliveries) — same clamp
 * behavior, one place to read it.
 *
 * Note this only clamps the UPPER bound (and substitutes the default for a
 * missing limit) — it does not reject/clamp a caller-supplied value below 1
 * (e.g. `0` or a negative number), matching the exact behavior of the
 * `Math.min(limit ?? dflt, max)` expressions this replaces.
 */
export function clampLimit(limit: number | null | undefined, max: number, dflt: number): number {
  return Math.min(limit ?? dflt, max);
}
