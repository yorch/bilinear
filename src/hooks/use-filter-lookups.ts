'use client';

import type { FilterLookups } from '@/components/issues/filter-builder';
import { SCALE_OPTIONS } from '@/components/properties/estimate-picker';
import { getCycleDisplayName } from '@/lib/cycle-utils';
import type { FilterContext } from '@/lib/filter-engine';
import { useStore } from '@/providers/store-provider';

/**
 * Project and cycle options for the filter builder's value pickers, read from
 * the MobX stores (call from an `observer()` component so they stay live).
 * Pass `teamId` to restrict cycles to one team; omit it (My Issues) for all.
 */
export function useFilterLookups(teamId?: string | null): FilterLookups {
  const { cycleStore, projectStore, teamStore } = useStore();
  const cycles = teamId ? cycleStore.findByTeamId(teamId) : cycleStore.all;
  // Across teams ("Cycle 3" exists in each), qualify the label with the team key.
  const teams = teamStore.all;
  const qualify = !teamId && teams.length > 1;
  return {
    cycles: cycles.map(c => ({
      id: c.id,
      label: qualifyCycleLabel(
        getCycleDisplayName(c),
        qualify ? teamStore.findById(c.teamId)?.key : undefined,
      ),
      number: c.number,
    })),
    estimateScaleMixed: !teamId && hasMixedEstimationScales(teams),
    projects: projectStore.all.map(p => ({ id: p.id, name: p.name })),
  };
}

/** `ENG · Sprint 3` when a team key is given, else the bare label. */
export function qualifyCycleLabel(label: string, teamKey?: string): string {
  return teamKey ? `${teamKey} · ${label}` : label;
}

/** Whether the teams use more than one estimation scale (teams with estimates off don't count). */
export function hasMixedEstimationScales(
  teams: { issueEstimationType?: string | null }[],
): boolean {
  const scales = teams.map(t => t.issueEstimationType ?? '').filter(type => type in SCALE_OPTIONS);
  return new Set(scales).size > 1;
}

/** Engine context for `overdue`: closed (completed/canceled) issues are never overdue. */
export function buildFilterContext(states: { id: string; type: string }[]): FilterContext {
  const closed = new Set(
    states.filter(s => s.type === 'completed' || s.type === 'canceled').map(s => s.id),
  );
  return { isClosedState: id => closed.has(id) };
}
