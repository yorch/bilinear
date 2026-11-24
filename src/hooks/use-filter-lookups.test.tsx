import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const teams = [
  { id: 't1', issueEstimationType: 'tShirt', key: 'ENG' },
  { id: 't2', issueEstimationType: 'fibonacci', key: 'OPS' },
];
const cycles = [
  { id: 'c1', name: null, number: 3, teamId: 't1' },
  { id: 'c2', name: null, number: 3, teamId: 't2' },
];
let teamList = teams;

vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({
    cycleStore: { all: cycles, findByTeamId: (id: string) => cycles.filter(c => c.teamId === id) },
    projectStore: { all: [] },
    teamStore: { all: teamList, findById: (id: string) => teamList.find(t => t.id === id) },
  }),
}));

const { hasMixedEstimationScales, qualifyCycleLabel, useFilterLookups } = await import(
  './use-filter-lookups'
);

describe('useFilterLookups across teams', () => {
  it('qualifies cycle labels with the team key so "Cycle 3" is not ambiguous', () => {
    teamList = teams;
    const { result } = renderHook(() => useFilterLookups());
    expect(result.current.cycles?.map(c => c.label)).toEqual(['ENG · Cycle 3', 'OPS · Cycle 3']);
  });

  it('leaves labels bare for a single team and flags mixed estimate scales for several', () => {
    teamList = teams;
    const single = renderHook(() => useFilterLookups('t1')).result.current;
    expect(single.cycles?.map(c => c.label)).toEqual(['Cycle 3']);
    expect(single.estimateScaleMixed).toBe(false);
    expect(renderHook(() => useFilterLookups()).result.current.estimateScaleMixed).toBe(true);
  });
});

describe('hasMixedEstimationScales', () => {
  it('ignores teams with estimates off and teams sharing a scale', () => {
    expect(
      hasMixedEstimationScales([
        { issueEstimationType: 'fibonacci' },
        { issueEstimationType: 'notUsed' },
      ]),
    ).toBe(false);
    expect(
      hasMixedEstimationScales([
        { issueEstimationType: 'fibonacci' },
        { issueEstimationType: 'fibonacci' },
      ]),
    ).toBe(false);
    expect(
      hasMixedEstimationScales([
        { issueEstimationType: 'fibonacci' },
        { issueEstimationType: 'tShirt' },
      ]),
    ).toBe(true);
  });
  it('qualifyCycleLabel is a no-op without a key', () => {
    expect(qualifyCycleLabel('Sprint', undefined)).toBe('Sprint');
  });
});
