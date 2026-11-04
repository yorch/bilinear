import { describe, expect, it } from 'vitest';
import { disambiguateStateNames, groupIssuesByTeam } from './multi-team-issues';

describe('groupIssuesByTeam', () => {
  const issues = [
    { id: 'a', teamId: 'ops' },
    { id: 'b', teamId: 'eng' },
    { id: 'c', teamId: 'ops' },
    { id: 'd', teamId: 'ghost' },
  ];

  it('buckets by team, preserving issue order inside a bucket', () => {
    const groups = groupIssuesByTeam(issues, ['eng', 'ops']);
    expect(groups.map(g => g.teamId)).toEqual(['eng', 'ops', 'ghost']);
    expect(groups[1].issues.map(i => i.id)).toEqual(['a', 'c']);
  });

  it('puts teams missing from the order last instead of dropping them', () => {
    expect(groupIssuesByTeam(issues, ['ops']).map(g => g.teamId)).toEqual(['ops', 'eng', 'ghost']);
  });

  it('yields one group for a single team', () => {
    expect(groupIssuesByTeam([{ teamId: 'eng' }], ['eng'])).toHaveLength(1);
  });
});

describe('disambiguateStateNames', () => {
  const keys: Record<string, string> = { eng: 'ENG', ops: 'OPS' };
  const states = [
    { id: '1', name: 'Todo', teamId: 'eng' },
    { id: '2', name: 'Todo', teamId: 'ops' },
    { id: '3', name: 'Review', teamId: 'eng' },
  ];

  it('suffixes only names shared across teams', () => {
    const out = disambiguateStateNames(states, id => keys[id]);
    expect(out.map(s => s.name)).toEqual(['Todo · ENG', 'Todo · OPS', 'Review']);
  });

  it('leaves a single team untouched', () => {
    const out = disambiguateStateNames(
      states.filter(s => s.teamId === 'eng'),
      id => keys[id],
    );
    expect(out.map(s => s.name)).toEqual(['Todo', 'Review']);
  });

  it('keeps ids so filters still match the right rows', () => {
    expect(disambiguateStateNames(states, id => keys[id]).map(s => s.id)).toEqual(['1', '2', '3']);
  });
});
