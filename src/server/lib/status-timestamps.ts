/**
 * `now`: stamp the current time. `clear`: null out the column. `leave`:
 * don't touch it (the caller's existing value, if any, is left alone).
 */
export type StatusTimestampOp = 'now' | 'clear' | 'leave';

export interface StatusTimestampTransition {
  canceledAt: StatusTimestampOp;
  completedAt: StatusTimestampOp;
  startedAt: StatusTimestampOp;
}

export interface StatusTimestampPatch {
  canceledAt?: Date | null;
  completedAt?: Date | null;
  startedAt?: Date | null;
}

/**
 * Table-driven lifecycle-timestamp patch for a transition into `newStatus`.
 * `table` maps each status value to which of startedAt/completedAt/
 * canceledAt should be stamped `now`, cleared to `null`, or `leave`-alone.
 * This is the shared piece of `ProjectService.update` (statusType) and
 * `InitiativeService.update` (status) — both declared a near-identical
 * `STATUS_TRANSITION_CLEARS` table plus an inline `apply()` closure that
 * turned each op into `now | null | undefined` for a Prisma partial update.
 *
 * Returns `{}` (no-op patch) when `newStatus` has no entry in `table` —
 * mirrors `ProjectService`'s original `if (transition) { ... }` guard
 * (`InitiativeService`'s table covers every `InitiativeStatus`, so this
 * branch is unreachable there, same as before extraction).
 *
 * Deliberately does NOT implement "first-set" startedAt preservation
 * (skipping the `now` stamp on a no-op re-save or a paused/resumed
 * re-entry) — `ProjectService` and `InitiativeService` each check that
 * against a fresh DB read with a SLIGHTLY different condition
 * (`InitiativeService` additionally requires the row's *current* status to
 * already equal the entered status before it will preserve; `ProjectService`
 * preserves whenever `startedAt` already has any value, regardless of the
 * row's current status). Folding either one of those into this shared
 * helper would silently change the other's observable behavior for an
 * untested edge case, so both callers keep doing their own current-row
 * check and un-set the returned `startedAt` locally when it applies.
 */
export function applyStatusTransitionTimestamps<TStatus extends string>(
  table: Partial<Record<TStatus, StatusTimestampTransition>>,
  newStatus: TStatus,
  now: Date,
): StatusTimestampPatch {
  const transition = table[newStatus];
  if (!transition) {
    return {};
  }
  const apply = (op: StatusTimestampOp): Date | null | undefined => {
    if (op === 'now') {
      return now;
    }
    if (op === 'clear') {
      return null;
    }
    return undefined;
  };
  return {
    canceledAt: apply(transition.canceledAt),
    completedAt: apply(transition.completedAt),
    startedAt: apply(transition.startedAt),
  };
}
