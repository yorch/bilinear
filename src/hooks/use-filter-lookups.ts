'use client';

import type { FilterLookups } from '@/components/issues/filter-builder';
import { getCycleDisplayName } from '@/lib/cycle-utils';
import type { FilterContext } from '@/lib/filter-engine';
import { useStore } from '@/providers/store-provider';

/**
 * Project and cycle options for the filter builder's value pickers, read from
 * the MobX stores (call from an `observer()` component so they stay live).
 * Pass `teamId` to restrict cycles to one team; omit it (My Issues) for all.
 */
export function useFilterLookups(teamId?: string | null): FilterLookups {
  const { cycleStore, projectStore } = useStore();
  const cycles = teamId ? cycleStore.findByTeamId(teamId) : cycleStore.all;
  return {
    cycles: cycles.map(c => ({ id: c.id, label: getCycleDisplayName(c), number: c.number })),
    projects: projectStore.all.map(p => ({ id: p.id, name: p.name })),
  };
}

/** Engine context for `overdue`: closed (completed/canceled) issues are never overdue. */
export function buildFilterContext(states: { id: string; type: string }[]): FilterContext {
  const closed = new Set(
    states.filter(s => s.type === 'completed' || s.type === 'canceled').map(s => s.id),
  );
  return { isClosedState: id => closed.has(id) };
}
