import { describe, expect, it } from 'vitest';
import { sortIssuesByState, stateChartColor } from './planning-utils';

const states: Record<string, { type: string; position: number }> = {
  doing: { position: 2, type: 'started' },
  done: { position: 3, type: 'completed' },
  todo: { position: 1, type: 'unstarted' },
};

describe('sortIssuesByState', () => {
  it('orders started, unstarted, then completed, and by identifier within a state', () => {
    const issues = [
      { identifier: 'ENG-2', stateId: 'done' },
      { identifier: 'ENG-10', stateId: 'todo' },
      { identifier: 'ENG-9', stateId: 'todo' },
      { identifier: 'ENG-3', stateId: 'doing' },
    ];
    expect(sortIssuesByState(issues, id => states[id]).map(i => i.identifier)).toEqual([
      'ENG-3',
      'ENG-9',
      'ENG-10',
      'ENG-2',
    ]);
  });
  it('does not mutate its input', () => {
    const issues = [
      { identifier: 'B-1', stateId: 'done' },
      { identifier: 'A-1', stateId: 'doing' },
    ];
    sortIssuesByState(issues, id => states[id]);
    expect(issues[0].identifier).toBe('B-1');
  });
});

describe('stateChartColor', () => {
  it('routes neutral not-started states through the theme-aware token', () => {
    expect(stateChartColor({ color: '#e2e8f0', type: 'unstarted' })).toBe('var(--state-default)');
    expect(stateChartColor({ color: '#e2e8f0', type: 'backlog' })).toBe('var(--state-default)');
  });
  it('keeps the stored colour for states that carry meaning', () => {
    expect(stateChartColor({ color: '#10b981', type: 'completed' })).toBe('#10b981');
  });
});
