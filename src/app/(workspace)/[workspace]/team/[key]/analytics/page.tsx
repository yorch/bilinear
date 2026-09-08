'use client';

import { observer } from 'mobx-react-lite';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { CycleVelocitySection } from '@/components/analytics/cycle-velocity-section';
import { InsightsSection } from '@/components/analytics/insights-section';
import { InlineRetry } from '@/components/shared/inline-retry';
import { ColorDot } from '@/components/ui/color-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
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

// ---------------------------------------------------------------------------
// Team Health types + query
// ---------------------------------------------------------------------------

interface TeamHealthResult {
  oldestOpenAgeDays: number;
  openCount: number;
  overdueCount: number;
  p75AgeDays: number;
  unestimatedCount: number;
  unestimatedPct: number;
}

const TEAM_HEALTH_QUERY = `
  query TeamHealth($input: AnalyticsInput) {
    analyticsTeamHealth(input: $input) {
      overdueCount
      unestimatedCount
      unestimatedPct
      openCount
      oldestOpenAgeDays
      p75AgeDays
    }
  }
`;

// ---------------------------------------------------------------------------
// Bar chart primitive (pure CSS, no library)
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: Array<{ label: string; value: number; color?: string }>;
  emptyMessage?: string;
  maxValue?: number;
  unit?: string;
}

/**
 * A column chart that actually has columns.
 *
 * The previous version put `height: <pct>%` on a bar inside a column whose own
 * height was `auto` — a percentage height against an auto-height parent
 * resolves to nothing, so every bar collapsed to its 4px `minHeight` floor and
 * the chart rendered as a row of numbers floating above thin coloured
 * underlines, regardless of the values. The fix is structural: the column is
 * `h-full`, the bar sits in a `flex-1` track that justifies to the end, and the
 * percentage finally has something to be a percentage of. The 4% floor is gone
 * with it — a bar's height is now the only thing encoding its value, so a floor
 * would be a lie about small numbers.
 */
function BarChart({ data, maxValue, unit = '', emptyMessage }: BarChartProps) {
  const t = useTranslations();
  const max = maxValue ?? Math.max(...data.map(d => d.value), 1);

  if (data.length === 0 || data.every(d => d.value === 0)) {
    return <EmptyState size="compact" title={emptyMessage ?? t('analytics.team.noData')} />;
  }

  return (
    <div className="flex h-40 items-stretch gap-2">
      {data.map(item => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1" key={item.label}>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {item.value > 0 ? `${item.value}${unit}` : ''}
            </span>
            {/* The track makes an empty column read as "zero" rather than as a
                missing bar, and gives the columns a shared baseline. */}
            <div className="flex w-full flex-1 flex-col justify-end rounded-t bg-muted/60">
              <div
                className="w-full rounded-t transition-[height]"
                style={{
                  backgroundColor: item.color ?? 'var(--chart-primary)',
                  height: `${pct}%`,
                }}
              />
            </div>
            <span
              className="max-w-full truncate text-[10px] text-muted-foreground"
              title={item.label}
            >
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team-health stat card
// ---------------------------------------------------------------------------

/**
 * One Team Health figure.
 *
 * `tone` is deliberately opt-in and defaults to neutral. Only a metric whose
 * zero has one obvious reading earns a colour: "0 overdue" is good news, but
 * "0 days oldest open" and "0% unestimated" are ambiguous without a target the
 * product does not ask the user for. Inventing thresholds for those would make
 * the card assert something the data cannot support.
 */
const HEALTH_TONE = {
  bad: {
    label: 'text-danger-subtle-foreground',
    shell: 'border border-danger/40 bg-danger-subtle',
    value: 'text-danger-subtle-foreground',
  },
  good: {
    label: 'text-success-subtle-foreground',
    shell: 'border border-success/40 bg-success-subtle',
    value: 'text-success-subtle-foreground',
  },
  neutral: {
    label: 'text-muted-foreground',
    shell: 'border border-border bg-card',
    value: 'text-foreground',
  },
} as const;

function HealthStat({
  hint,
  label,
  tone = 'neutral',
  value,
}: {
  hint?: string;
  label: string;
  tone?: keyof typeof HEALTH_TONE;
  value: number | string;
}) {
  const styles = HEALTH_TONE[tone];
  return (
    <div className={cn('rounded-lg p-4', styles.shell)}>
      <p className={cn('text-xs font-medium uppercase tracking-wider', styles.label)}>{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', styles.value)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
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

function HBarChart({ data, maxValue, emptyMessage }: HBarChartProps) {
  const t = useTranslations();
  const max = maxValue ?? Math.max(...data.map(d => d.value), 1);

  if (data.length === 0) {
    return <EmptyState size="compact" title={emptyMessage ?? t('analytics.team.noData')} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {data.map(item => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div className="flex items-center gap-2" key={item.label}>
            <span
              className="w-28 shrink-0 truncate text-xs text-muted-foreground"
              title={item.label}
            >
              {item.label}
            </span>
            {/* The track carries its own height so a zero-value row still
                reads as an empty bar rather than a missing one; the 2% floor is
                gone, since a floor makes 1 and 0 look the same. */}
            <div className="h-5 flex-1 rounded bg-muted">
              <div
                className="h-5 rounded transition-[width]"
                style={{
                  backgroundColor: item.color ?? 'var(--chart-primary)',
                  width: `${pct}%`,
                }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TeamAnalyticsPage = observer(function TeamAnalyticsPage() {
  const t = useTranslations();
  useDocumentTitle(t('analytics.team.title'));
  const { formatDate } = useFormatters();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
  const issues = useMemo(
    () => (teamId ? issueStore.findByTeamId(teamId) : []),
    [teamId, issueStore.pool.size],
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: pool.size is the intentional reactive trigger
  const states = useMemo(
    () => (teamId ? workflowStateStore.findByTeamId(teamId) : []),
    [teamId, workflowStateStore.pool.size],
  );

  // A plain read of the MobX computed — `observer` tracks it, and the computed is
  // cached while observed, so a memo would add nothing. Deliberately NOT keyed on
  // `pool.size` like `issues`/`states` above: those wrap a prototype *method*
  // whose identity never changes, whereas `all` already changes identity on an
  // in-place row update such as a rename.
  const users = userStore.all;

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
      // `canceled`, one L — the WorkflowState.type value the server writes.
      // Spelled `cancelled` this set was always empty, so every canceled
      // issue fell through to the "open" bucket in the completion rate below.
      canceledStateIds: new Set(states.filter(s => s.type === 'canceled').map(s => s.id)),
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
      label: formatDate(w.start, { day: 'numeric', month: 'short' }),
      value: w.count,
    }));
  }, [issues, preset, formatDate]);

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
      rows.push({
        color: 'var(--chart-muted)',
        label: t('analytics.team.unassigned'),
        value: unassigned,
      });
    }

    return rows;
  }, [issues, users, completedStateIds, canceledStateIds, t]);

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

  // ── Team health (fetched from GraphQL, not MobX store) ────────────────────

  // A failed read must not leave `teamHealth` null, silently unmounting the
  // whole Team Health panel with no indication anything had failed.
  const {
    data: teamHealth,
    error: teamHealthError,
    refetch: retryTeamHealth,
  } = useRetryableFetch<TeamHealthResult | null>(
    () =>
      teamId
        ? gqlQuery<TeamHealthResult>(
            TEAM_HEALTH_QUERY,
            { input: { teamId } },
            'analyticsTeamHealth',
          )
        : Promise.resolve(null),
    [teamId],
    null,
  );

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('analytics.team.loading')}
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('analytics.team.teamNotFound')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Page header */}
      <PageHeader
        actions={
          // SegmentedControl, not a hand-rolled copy of it: this was a
          // pixel-approximation of the same primitive the Insights section
          // below used, so the page's two range toggles did not even match
          // each other.
          <SegmentedControl
            onChange={setPreset}
            options={(['30d', '90d', '180d', 'all'] as const).map(p => ({
              label: p === 'all' ? t('analytics.team.rangeAll') : p,
              value: p,
            }))}
            size="md"
            value={preset}
          />
        }
        description={`${team.displayName || team.name}${
          preset !== 'all'
            ? ` · ${t('analytics.team.lastPreset', { preset })}`
            : ` · ${t('analytics.team.allTime')}`
        }`}
        title={t('analytics.team.title')}
      />

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Summary stats row */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t('analytics.team.totalIssues')}
            sub={
              preset !== 'all'
                ? t('analytics.team.lastPreset', { preset })
                : t('analytics.team.allTime')
            }
            value={rangeIssues.length}
          />
          <StatCard
            label={t('analytics.team.completionRate')}
            sub={t('analytics.team.closedOfTotal', {
              completed: completedCount,
              total: rangeIssues.length,
            })}
            value={`${completionRate}%`}
          />
          <StatCard
            label={t('analytics.team.avgVelocity')}
            sub={t('analytics.team.overActiveWeeks')}
            value={avgVelocity === 0 ? '—' : `${avgVelocity}/wk`}
          />
          <StatCard
            label={t('analytics.team.avgCycleTime')}
            sub={t('analytics.team.startedToCompleted')}
            value={avgCycleTimeDays !== null ? `${avgCycleTimeDays}d` : '—'}
          />
        </div>

        {/* Issue status breakdown */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              color: 'text-muted-foreground',
              label: t('analytics.team.statusOpen'),
              value: openCount,
            },
            {
              color: 'text-info-subtle-foreground',
              label: t('analytics.team.statusInProgress'),
              value: inProgressCount,
            },
            {
              color: 'text-success-subtle-foreground',
              label: t('analytics.team.statusCompleted'),
              value: completedCount,
            },
            {
              color: 'text-muted-foreground',
              label: t('analytics.team.statusCanceled'),
              value: canceledCount,
            },
          ].map(item => (
            <div className="rounded-lg border border-border bg-card p-4" key={item.label}>
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
              <p className={cn('mt-1 text-2xl font-semibold', item.color)}>{item.value}</p>
            </div>
          ))}
        </div>

        {/* Charts grid */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Section title={t('analytics.team.issuesByState')}>
            <BarChart data={byStateData} emptyMessage={t('analytics.team.noIssuesYet')} />
          </Section>

          <Section title={t('analytics.team.velocityPerWeek')}>
            <BarChart data={velocityData} emptyMessage={t('analytics.team.noCompletedIssuesYet')} />
          </Section>

          <Section title={t('analytics.team.assigneeWorkload')}>
            <HBarChart
              data={workloadData}
              emptyMessage={t('analytics.team.noOpenIssuesAssigned')}
            />
          </Section>

          <Section title={t('analytics.team.issueBreakdown')}>
            <div className="space-y-3">
              {byStateData.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('analytics.team.noIssuesYet')}</p>
              ) : (
                byStateData.map(item => {
                  const pct =
                    rangeIssues.length > 0
                      ? Math.round((item.value / rangeIssues.length) * 100)
                      : 0;
                  return (
                    <div className="flex flex-col gap-1" key={item.label}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <ColorDot color={item.color} />
                          {item.label}
                        </span>
                        <span className="font-medium text-muted-foreground">
                          {item.value} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted">
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

        {/* Team Health */}
        {teamHealthError && (
          <div className="mt-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t('analytics.team.teamHealth')}
            </h2>
            <InlineRetry
              message={t('analytics.workspace.failedToLoad')}
              onRetry={retryTeamHealth}
            />
          </div>
        )}
        {/* `teamHealth` survives a failed refetch, so the error branch wins. */}
        {!teamHealthError && teamHealth && (
          <div className="mt-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              {t('analytics.team.teamHealth')}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <HealthStat label={t('analytics.team.openIssues')} value={teamHealth.openCount} />
              {/* The only card whose tone varies, because it is the only one
                  whose zero has an unambiguous reading. It used to be painted
                  danger unconditionally, so "OVERDUE 0" — the best possible
                  news — arrived as a red alarm. */}
              <HealthStat
                label={t('analytics.team.overdue')}
                tone={teamHealth.overdueCount > 0 ? 'bad' : 'good'}
                value={teamHealth.overdueCount}
              />
              <HealthStat
                hint={t('analytics.team.pctOfOpen', {
                  pct: teamHealth.unestimatedPct.toFixed(0),
                })}
                label={t('analytics.team.unestimated')}
                value={teamHealth.unestimatedCount}
              />
              <HealthStat
                label={t('analytics.team.oldestOpen')}
                value={`${teamHealth.oldestOpenAgeDays.toFixed(0)}d`}
              />
              <HealthStat
                hint={t('analytics.team.percentile75')}
                label={t('analytics.team.p75Age')}
                value={`${teamHealth.p75AgeDays.toFixed(0)}d`}
              />
            </div>
          </div>
        )}

        {teamId && <CycleVelocitySection teamId={teamId} />}
      </div>
    </div>
  );
});

export default TeamAnalyticsPage;
