import type { DBCycle } from '@/lib/db';

export function isActiveCycle(cycle: DBCycle): boolean {
  const now = Date.now();
  const startsAtMs = new Date(cycle.startsAt).getTime();
  const endsAtMs = new Date(cycle.endsAt).getTime();
  return !cycle.completedAt && startsAtMs <= now && endsAtMs > now;
}

export function getCycleDisplayName(cycle: DBCycle): string {
  return cycle.name || `Cycle ${cycle.number}`;
}
