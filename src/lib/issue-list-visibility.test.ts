import { describe, expect, it } from 'vitest';
import {
  excludeTriageIssues,
  filterCompletedIssues,
  stateIdsOfType,
} from './issue-list-visibility';

const NOW = new Date('2026-11-24T12:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const closed = new Set(['done', 'canceled']);
const issues = [
  { id: 'open', stateId: 'todo' },
  { completedAt: iso(2 * DAY), id: 'recent-done', stateId: 'done' },
  { completedAt: iso(30 * DAY), id: 'old-done', stateId: 'done' },
  { canceledAt: iso(1 * DAY), id: 'recent-canceled', stateId: 'canceled' },
  { id: 'done-no-date', stateId: 'done' },
];
const ids = (list: { id: string }[]) => list.map(i => i.id);

describe('filterCompletedIssues', () => {
  it('all keeps everything (same reference)', () => {
    expect(filterCompletedIssues(issues, 'all', closed, NOW)).toBe(issues);
  });

  it('none hides every completed and canceled issue', () => {
    expect(ids(filterCompletedIssues(issues, 'none', closed, NOW))).toEqual(['open']);
  });

  it('pastWeek keeps open work and issues closed within 7 days', () => {
    expect(ids(filterCompletedIssues(issues, 'pastWeek', closed, NOW))).toEqual([
      'open',
      'recent-done',
      'recent-canceled',
    ]);
  });
});

describe('excludeTriageIssues', () => {
  const list = [
    { id: 'a', stateId: 'triage' },
    { id: 'b', stateId: 'todo' },
  ];

  it('hides triage-state issues when the team has triage enabled', () => {
    expect(ids(excludeTriageIssues(list, true, new Set(['triage'])))).toEqual(['b']);
  });

  it('keeps them when triage is off (the state is not a queue then)', () => {
    expect(excludeTriageIssues(list, false, new Set(['triage']))).toBe(list);
  });
});

describe('stateIdsOfType', () => {
  it('collects ids by workflow type', () => {
    const states = [
      { id: 's1', type: 'completed' },
      { id: 's2', type: 'started' },
      { id: 's3', type: 'canceled' },
    ];
    expect([...stateIdsOfType(states, ['completed', 'canceled'])]).toEqual(['s1', 's3']);
  });
});
