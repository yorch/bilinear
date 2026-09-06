/**
 * Serialise a `Date` as its UTC calendar day, `YYYY-MM-DD` — the wire form of
 * the GraphQL `Date` scalar and of date-only columns (`dueDate`, `startDate`,
 * analytics week buckets). One helper so every resolver slices the same way.
 */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
