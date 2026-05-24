'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { InsightsSection } from '@/components/analytics/insights-section';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the Monday of the ISO week containing `date`. */
function weekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Format a Date as "MMM D". */
function fmtShort(date: Date): string {
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------------
// Bar chart primitive (pure CSS, no library)
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: Array<{ label: string; value: number; color?: string }>;
  emptyMessage?: string;
  maxValue?: number;
  unit?: string;
}

function BarChart({ data, maxValue, unit = '', emptyMessage = 'No data' }: BarChartProps) {
  const max = maxValue ?? Math.max(...data.map(d => d.value), 1);

  if (data.length === 0 || data.every(d => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <div className="flex items-end gap-2 h-36">
      {data.map(item => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={item.label}>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {item.value > 0 ? `${item.value}${unit}` : ''}
            </span>
            <div
              className="w-full rounded-t"
              style={{
                backgroundColor: item.color ?? 'var(--chart-primary)',
                height: `${Math.max(pct, item.value > 0 ? 4 : 0)}%`,
                minHeight: item.value > 0 ? '4px' : '0',
              }}
            />
            <span className="max-w-full truncate text-[10px] text-zinc-400" title={item.label}>
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar chart (for assignee workload)
// ---------------------------------------------------------------------------

interface HBarChartProps {
  data: Array<{
    label: string;
    value: number;
    sublabel?: string;
    color?: string;
  }>;
  emptyMessage?: string;
  maxValue?: number;
}

function HBarChart({ data, maxValue, emptyMessage = 'No data' }: HBarChartProps) {
  const max = maxValue ?? Math.max(...data.map(d => d.value), 1);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map(item => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div className="flex items-center gap-2" key={item.label}>
            <span className="w-28 shrink-0 truncate text-xs text-zinc-500" title={item.label}>
              {item.label}
            </span>
            <div className="flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
              <div
                className="h-5 rounded transition-all"
                style={{
                  backgroundColor: item.color ?? 'var(--chart-primary)',
                  width: `${Math.max(pct, item.value > 0 ? 2 : 0)}%`,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-medium text-zinc-600 dark:text-zinc-300">
              {item.value}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  sub?: string;
  value: string | number;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TeamAnalyticsPage = observer(function TeamAnalyticsPage() {
  const { key: teamKey } = useParams<{ workspace: string; key: string }>();
  const { issueStore, teamStore, workflowStateStore, userStore, syncStore } = useStore();

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  const team = teamStore.findByKey(teamKey);
  const teamId = team?.id ?? null;

  // ── Date-range preset ─────────────────────────────────────────────────────

  type RangePreset = '30d' | '90d' | '180d' | 'all';
  const [preset, setPreset] = useState<RangePreset>('90d');

  const cutoff = useMemo<Date | null>(() => {
    if (preset === 'all') {
      return null;
    }
    const days = { '30d': 30, '90d': 90, '180d': 180 }[preset];
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }, [preset]);

  // ── Raw data ─────────────────────────────────────────────────────────────

  const issues = useMemo(
    () => (teamId ? issueStore.findByTeamId(teamId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId, issueStore.findByTeamId],
  );

  // Issues filtered by date range (created or completed within the window).
  // Workload (open issues) is intentionally kept all-time below.
  const rangeIssues = useMemo(() => {
    if (!cutoff) {
      return issues;
    }
    return issues.filter(i => {
      const created = new Date(i.createdAt);
      const completed = i.completedAt ? new Date(i.completedAt) : null;
      return created >= cutoff || (completed !== null && completed >= cutoff);
    });
  }, [issues, cutoff]);

  const states = useMemo(
    () => (teamId ? workflowStateStore.findByTeamId(teamId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId, workflowStateStore.findByTeamId],
  );

  const users = useMemo(
    () => userStore.all,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userStore.all],
  );

  // ── Issues by state ───────────────────────────────────────────────────────

  const byStateData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of rangeIssues) {
      counts.set(issue.stateId, (counts.get(issue.stateId) ?? 0) + 1);
    }
    return states
      .filter(s => counts.has(s.id))
      .map(s => ({
        color: s.color,
        label: s.name,
        value: counts.get(s.id) ?? 0,
      }));
  }, [rangeIssues, states]);

  // ── Completion rate ────────────────────────────────────────────────────────

  const { completedStateIds, canceledStateIds } = useMemo(
    () => ({
      canceledStateIds: new Set(states.filter(s => s.type === 'cancelled').map(s => s.id)),
      completedStateIds: new Set(states.filter(s => s.type === 'completed').map(s => s.id)),
    }),
    [states],
  );

  const { completedCount, inProgressCount, openCount, canceledCount } = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let open = 0;
    let canceled = 0;
    for (const i of rangeIssues) {
      if (completedStateIds.has(i.stateId)) {
        completed++;
      } else if (canceledStateIds.has(i.stateId)) {
        canceled++;
      } else {
        const state = states.find(s => s.id === i.stateId);
        if (state?.type === 'started') {
          inProgress++;
        } else {
          open++;
        }
      }
    }
    return {
      canceledCount: canceled,
      completedCount: completed,
      inProgressCount: inProgress,
      openCount: open,
    };
  }, [rangeIssues, completedStateIds, canceledStateIds, states]);

  const completionRate =
    rangeIssues.length > 0 ? Math.round((completedCount / rangeIssues.length) * 100) : 0;

  // ── Velocity: closed per week within the selected range ──────────────────

  const velocityData = useMemo(() => {
    const weekCount = preset === '30d' ? 4 : preset === '90d' ? 13 : preset === '180d' ? 26 : 52;
    const now = new Date();
    const weeks: Array<{ start: Date; count: number }> = [];
    for (let i = weekCount - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      weeks.push({ count: 0, start: weekStart(d) });
    }

    const weekMap = new Map(weeks.map(w => [w.start.getTime(), w]));
    for (const issue of issues) {
      if (!issue.completedAt) {
        continue;
      }
      const bin = weekMap.get(weekStart(new Date(issue.completedAt)).getTime());
      if (bin) {
        bin.count++;
      }
    }

    return weeks.map(w => ({
      color: 'var(--chart-primary)',
      label: fmtShort(w.start),
      value: w.count,
    }));
  }, [issues, preset]);

  const avgVelocity = useMemo(() => {
    const nonZero = velocityData.filter(w => w.value > 0);
    if (nonZero.length === 0) {
      return 0;
    }
    return Math.round(nonZero.reduce((s, w) => s + w.value, 0) / nonZero.length);
  }, [velocityData]);

  // ── Assignee workload (open issues) ───────────────────────────────────────

  const workloadData = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const issue of issues) {
      if (completedStateIds.has(issue.stateId) || canceledStateIds.has(issue.stateId)) {
        continue;
      }
      if (issue.assigneeId) {
        counts.set(issue.assigneeId, (counts.get(issue.assigneeId) ?? 0) + 1);
      } else {
        unassigned++;
      }
    }

    const rows = users
      .filter(u => counts.has(u.id))
      .map(u => ({
        color: 'var(--chart-primary)',
        label: u.displayName,
        value: counts.get(u.id) ?? 0,
      }))
      .sort((a, b) => b.value - a.value);

    if (unassigned > 0) {
      rows.push({ color: 'var(--chart-muted)', label: 'Unassigned', value: unassigned });
    }

    return rows;
  }, [issues, users, completedStateIds, canceledStateIds]);

  // ── Cycle time (avg days from started → completed) ─────────────────────────

  const avgCycleTimeDays = useMemo(() => {
    const durations: number[] = [];
    for (const issue of rangeIssues) {
      if (issue.startedAt && issue.completedAt) {
        const ms = new Date(issue.completedAt).getTime() - new Date(issue.startedAt).getTime();
        if (ms > 0) {
          durations.push(ms / 86_400_000);
        }
      }
    }
    if (durations.length === 0) {
      return null;
    }
    return (durations.reduce((s, d) => s + d, 0) / durations.length).toFixed(1);
  }, [rangeIssues]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading...
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Team not found.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Page header */}
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Analytics</h1>
            <p className="mt-0.5 text-xs text-zinc-400">
              {team.displayName || team.name}
              {preset !== 'all' ? ` · last ${preset}` : ' · all time'}
            </p>
          </div>
          <div className="flex shrink-0 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(['30d', '90d', '180d', 'all'] as const).map(p => (
              <button
                className={cn(
                  'rounded px-2.5 py-1 text-xs',
                  preset === p
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
                )}
                key={p}
                onClick={() => setPreset(p)}
                type="button"
              >
                {p === 'all' ? 'All' : p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Summary stats row */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total issues"
            sub={preset !== 'all' ? `last ${preset}` : 'all time'}
            value={rangeIssues.length}
          />
          <StatCard
            label="Completion rate"
            sub={`${completedCount} of ${rangeIssues.length} closed`}
            value={`${completionRate}%`}
          />
          <StatCard
            label="Avg velocity"
            sub="over active weeks"
            value={avgVelocity === 0 ? '—' : `${avgVelocity}/wk`}
          />
          <StatCard
            label="Avg cycle time"
            sub="started → completed"
            value={avgCycleTimeDays !== null ? `${avgCycleTimeDays}d` : '—'}
          />
        </div>

        {/* Issue status breakdown */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { color: 'text-zinc-400', label: 'Open', value: openCount },
            {
              color: 'text-blue-500',
              label: 'In progress',
              value: inProgressCount,
            },
            {
              color: 'text-green-500',
              label: 'Completed',
              value: completedCount,
            },
            { color: 'text-zinc-400', label: 'Canceled', value: canceledCount },
          ].map(item => (
            <div
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              key={item.label}
            >
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                {item.label}
              </p>
              <p className={cn('mt-1 text-2xl font-semibold', item.color)}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Section title="Issues by state">
            <BarChart data={byStateData} emptyMessage="No issues yet" />
          </Section>

          <Section title="Velocity (issues completed per week)">
            <BarChart data={velocityData} emptyMessage="No completed issues yet" />
          </Section>

          <Section title="Assignee workload (open issues)">
            <HBarChart data={workloadData} emptyMessage="No open issues assigned" />
          </Section>

          <Section title="Issue breakdown">
            <div className="space-y-3">
              {byStateData.length === 0 ? (
                <p className="text-sm text-zinc-400">No issues yet</p>
              ) : (
                byStateData.map(item => {
                  const pct =
                    rangeIssues.length > 0
                      ? Math.round((item.value / rangeIssues.length) * 100)
                      : 0;
                  return (
                    <div className="flex flex-col gap-1" key={item.label}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          {item.label}
                        </span>
                        <span className="font-medium text-zinc-500">
                          {item.value} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            backgroundColor: item.color,
                            width: `${pct}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Section>
        </div>

        {teamId && (
          <InsightsSection
            onPresetChange={setPreset}
            preset={preset}
            states={states.map(s => ({ color: s.color, id: s.id, name: s.name }))}
            teamId={teamId}
          />
        )}
      </div>
    </div>
  );
});

export default TeamAnalyticsPage;
