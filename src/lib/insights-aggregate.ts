/**
 * Insights v0 aggregation: Measure x Slice over an already-authorised issue
 * list. Pure — visibility scoping happens before rows reach this function, so
 * nothing here can widen what the viewer is allowed to see.
 */

export const INSIGHT_MEASURES = ['count', 'estimate', 'cycleTime'] as const;
export const INSIGHT_SLICES = [
  'status',
  'assignee',
  'label',
  'project',
  'priority',
  'team',
] as const;
export type InsightMeasure = (typeof INSIGHT_MEASURES)[number];
export type InsightSlice = (typeof INSIGHT_SLICES)[number];

/** Upper bound on issues scanned per Insights call (the UI quotes it). */
export const INSIGHTS_SCAN_LIMIT = 20_000;
/** Hard cap on groups returned; the rest are reported via `truncated`. */
export const MAX_INSIGHT_GROUPS = 50;
/** Key of the "no assignee / no label / no project" group. */
export const NONE_KEY = '__none__';

export interface InsightIssue {
  assignee: { id: string; name: string } | null;
  completedAt: Date | null;
  estimate: number | null;
  labels: Array<{ id: string; name: string }>;
  priority: number;
  project: { id: string; name: string } | null;
  startedAt: Date | null;
  state: { name: string };
  team: { id: string; name: string };
}

export interface InsightRow {
  issueCount: number;
  key: string;
  label: string;
  /** Rows contributing to `value` (cycle time only counts started+completed issues). */
  sampleSize: number;
  value: number;
}

export interface InsightResult {
  issueCount: number;
  measure: InsightMeasure;
  rows: InsightRow[];
  slice: InsightSlice;
  totalGroups: number;
  truncated: boolean;
}

const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

function groupsFor(
  issue: InsightIssue,
  slice: InsightSlice,
): Array<{ key: string; label: string }> {
  switch (slice) {
    case 'status':
      return [{ key: issue.state.name.toLowerCase(), label: issue.state.name }];
    case 'assignee':
      return [
        issue.assignee
          ? { key: issue.assignee.id, label: issue.assignee.name }
          : { key: NONE_KEY, label: 'Unassigned' },
      ];
    case 'label':
      // Multi-valued: an issue counts once under EACH of its labels, so label
      // rows can sum to more than the issue total. The UI says so.
      return issue.labels.length > 0
        ? issue.labels.map(l => ({ key: l.id, label: l.name }))
        : [{ key: NONE_KEY, label: 'No label' }];
    case 'project':
      return [
        issue.project
          ? { key: issue.project.id, label: issue.project.name }
          : { key: NONE_KEY, label: 'No project' },
      ];
    case 'priority':
      return [{ key: String(issue.priority), label: PRIORITY_LABELS[issue.priority] ?? 'Other' }];
    case 'team':
      return [{ key: issue.team.id, label: issue.team.name }];
  }
}

export function aggregateInsights(
  issues: InsightIssue[],
  measure: InsightMeasure,
  slice: InsightSlice,
  cap: number = MAX_INSIGHT_GROUPS,
): InsightResult {
  const acc = new Map<string, { label: string; n: number; samples: number; sum: number }>();
  for (const issue of issues) {
    let sample: number | null = null;
    if (measure === 'count') {
      sample = 1;
    } else if (measure === 'estimate') {
      sample = issue.estimate ?? 0;
    } else if (issue.startedAt && issue.completedAt) {
      sample = Math.max(0, (issue.completedAt.getTime() - issue.startedAt.getTime()) / 86_400_000);
    }
    for (const g of groupsFor(issue, slice)) {
      const entry = acc.get(g.key) ?? { label: g.label, n: 0, samples: 0, sum: 0 };
      entry.n += 1;
      if (sample !== null) {
        entry.samples += 1;
        entry.sum += sample;
      }
      acc.set(g.key, entry);
    }
  }

  let rows: InsightRow[] = [];
  for (const [key, e] of acc) {
    if (measure === 'cycleTime') {
      if (e.samples === 0) {
        continue; // an average over nothing is not 0 — leave the group out
      }
      rows.push({
        issueCount: e.n,
        key,
        label: e.label,
        sampleSize: e.samples,
        value: Math.round((e.sum / e.samples) * 10) / 10,
      });
    } else {
      rows.push({ issueCount: e.n, key, label: e.label, sampleSize: e.samples, value: e.sum });
    }
  }
  rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const totalGroups = rows.length;
  rows = rows.slice(0, cap);
  return {
    issueCount: issues.length,
    measure,
    rows,
    slice,
    totalGroups,
    truncated: totalGroups > cap,
  };
}
