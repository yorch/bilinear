import { describe, expect, it } from 'vitest';
import { aggregateInsights, csvSafeText, type InsightIssue, NONE_KEY } from './insights-aggregate';

const team = { id: 't1', name: 'Eng' };
const mk = (over: Partial<InsightIssue> = {}): InsightIssue => ({
  assignee: null,
  completedAt: null,
  estimate: null,
  labels: [],
  priority: 0,
  project: null,
  startedAt: null,
  state: { name: 'Todo' },
  team,
  ...over,
});
const at = (s: string) => new Date(`${s}T00:00:00Z`);

describe('aggregateInsights', () => {
  it('counts by status, case-merging state names across teams', () => {
    const r = aggregateInsights(
      [mk(), mk({ state: { name: 'todo' } }), mk({ state: { name: 'Done' } })],
      'count',
      'status',
    );
    expect(r.rows.map(x => [x.label, x.value])).toEqual([
      ['Todo', 2],
      ['Done', 1],
    ]);
  });

  it('sums estimates, treating unestimated as 0 but still counting the issue', () => {
    const a = { id: 'u1', name: 'Ann' };
    const r = aggregateInsights(
      [mk({ assignee: a, estimate: 3 }), mk({ assignee: a, estimate: 2 }), mk({ assignee: a })],
      'estimate',
      'assignee',
    );
    expect(r.rows[0]).toMatchObject({ issueCount: 3, key: 'u1', value: 5 });
  });

  it('puts unassigned work in an explicit none group', () => {
    const r = aggregateInsights([mk()], 'count', 'assignee');
    expect(r.rows[0].key).toBe(NONE_KEY);
  });

  it('counts a multi-label issue under each label', () => {
    const labels = [
      { id: 'l1', name: 'bug' },
      { id: 'l2', name: 'ui' },
    ];
    const r = aggregateInsights([mk({ labels })], 'count', 'label');
    expect(r.rows).toHaveLength(2);
    expect(r.issueCount).toBe(1);
  });

  it('averages cycle time over started+completed issues only and omits empty groups', () => {
    const r = aggregateInsights(
      [
        mk({ completedAt: at('2026-06-05'), priority: 1, startedAt: at('2026-06-01') }),
        mk({ completedAt: at('2026-06-03'), priority: 1, startedAt: at('2026-06-01') }),
        mk({ priority: 2, startedAt: at('2026-06-01') }), // not completed
      ],
      'cycleTime',
      'priority',
    );
    expect(r.rows).toEqual([{ issueCount: 2, key: '1', label: 'Urgent', sampleSize: 2, value: 3 }]);
  });

  it('caps groups and reports truncation', () => {
    const issues = Array.from({ length: 5 }, (_, i) =>
      mk({ team: { id: `t${i}`, name: `Team ${i}` } }),
    );
    const r = aggregateInsights(issues, 'count', 'team', 3);
    expect(r.rows).toHaveLength(3);
    expect(r).toMatchObject({ totalGroups: 5, truncated: true });
  });
});

describe('csvSafeText', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@x'])('prefixes %s', v => {
    expect(csvSafeText(v)).toBe(`'${v}`);
  });
  it('leaves ordinary text alone', () => {
    expect(csvSafeText('Bug fixes - Q3')).toBe('Bug fixes - Q3');
  });
});
