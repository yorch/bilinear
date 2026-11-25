'use client';

import { useEffect, useState } from 'react';

interface TriageCountIssue {
  snoozedUntilAt?: string | null;
  stateId: string;
}

/** Issues waiting in triage that are not currently snoozed. */
export function countActiveTriage(
  issues: readonly TriageCountIssue[],
  triageStateIds: ReadonlySet<string>,
  now: number,
): number {
  return issues.filter(
    i =>
      triageStateIds.has(i.stateId) &&
      (!i.snoozedUntilAt || new Date(i.snoozedUntilAt).getTime() <= now),
  ).length;
}

/**
 * The "N in triage" count. A snooze ending changes the count with no store
 * change, so reading the clock during render left it stale until something else
 * re-rendered; this schedules a re-render for the next snooze expiry.
 */
export function useTriageCount(
  issues: readonly TriageCountIssue[],
  triageStateIds: ReadonlySet<string>,
  enabled: boolean,
): number {
  const [, setTick] = useState(0);
  const now = Date.now();
  const count = enabled ? countActiveTriage(issues, triageStateIds, now) : 0;

  let nextExpiry = Number.POSITIVE_INFINITY;
  if (enabled) {
    for (const i of issues) {
      if (triageStateIds.has(i.stateId) && i.snoozedUntilAt) {
        const at = new Date(i.snoozedUntilAt).getTime();
        if (at > now && at < nextExpiry) {
          nextExpiry = at;
        }
      }
    }
  }

  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) {
      return;
    }
    // setTimeout caps at ~24.8 days; a longer snooze re-arms on the next render.
    const delay = Math.min(Math.max(nextExpiry - Date.now(), 0) + 50, 2 ** 31 - 1);
    const id = setTimeout(() => setTick(n => n + 1), delay);
    return () => clearTimeout(id);
  }, [nextExpiry]);

  return count;
}
