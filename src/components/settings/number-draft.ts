/**
 * Validation for a number knob's text draft, before anything is sent.
 *
 * The old commit path did `Number(draft)`, and `Number('')` is `0` — so
 * clearing a numeric field and tabbing away silently stored zero (a log sample
 * rate of 0, "0 upcoming cycles", a 0-day invite expiry). An empty or
 * non-numeric draft is therefore rejected here, with the reason, rather than
 * coerced.
 */
export type NumberDraftResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'range' };

export function parseNumberDraft(
  draft: string,
  bounds: { max?: number | null; min?: number | null } = {},
): NumberDraftResult {
  const trimmed = draft.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: 'invalid' };
  }
  if (
    (bounds.min !== null && bounds.min !== undefined && value < bounds.min) ||
    (bounds.max !== null && bounds.max !== undefined && value > bounds.max)
  ) {
    return { ok: false, reason: 'range' };
  }
  return { ok: true, value };
}
