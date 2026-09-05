'use client';

import { useMemo, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CycleVelocityPoint {
  completedIssues: number;
  completedPoints: number;
  cycleId: string;
  cycleNumber: number;
  cycleStartsAt: string;
}

interface CycleVelocityTrendResult {
  cycles: CycleVelocityPoint[];
  rolling3: number;
  rolling3Points: number;
  rolling6: number;
  rolling6Points: number;
  rolling12: number;
  rolling12Points: number;
}

interface CycleVelocitySectionProps {
  teamId: string;
}

// ---------------------------------------------------------------------------
// GraphQL query
// ---------------------------------------------------------------------------

const CYCLE_VELOCITY_TREND_QUERY = `
  query CycleVelocityTrend($input: AnalyticsInput) {
    analyticsCycleVelocityTrend(input: $input) {
      cycles {
        cycleId
        cycleNumber
        cycleStartsAt
        completedIssues
        completedPoints
      }
      rolling3
      rolling6
      rolling12
      rolling3Points
      rolling6Points
      rolling12Points
    }
  }
`;

// ---------------------------------------------------------------------------
// Bar chart (last 8 cycles)
// ---------------------------------------------------------------------------

interface VelocityBarChartProps {
  data: Array<{ label: string; value: number }>;
}

function VelocityBarChart({ data }: VelocityBarChartProps) {
  const t = useTranslations();
  const max = Math.max(...data.map(d => d.value), 1);

  if (data.length === 0 || data.every(d => d.value === 0)) {
    return <EmptyState size="compact" title={t('analytics.velocity.noCompletedCycles')} />;
  }

  return (
    <div className="flex h-36 items-end gap-2">
      {data.map(item => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={item.label}>
            <span className="text-xs font-medium text-muted-foreground">
              {item.value > 0 ? item.value : ''}
            </span>
            <div
              className="w-full rounded-t transition-all"
              style={{
                backgroundColor: 'var(--chart-primary)',
                height: `${Math.max(pct, item.value > 0 ? 4 : 0)}%`,
                minHeight: item.value > 0 ? '4px' : '0',
              }}
            />
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
// Rolling average stat card
// ---------------------------------------------------------------------------

interface RollingCardProps {
  label: string;
  value: number;
}

function RollingCard({ label, value }: RollingCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">
        {value === 0 ? '—' : value.toFixed(1)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type MetricMode = 'issues' | 'points';

export function CycleVelocitySection({ teamId }: CycleVelocitySectionProps) {
  const t = useTranslations();
  const [mode, setMode] = useState<MetricMode>('issues');

  // A rejected read must not render as "No completed cycles yet" plus three
  // em-dash rolling averages.
  const { data, error, loading, refetch } = useRetryableFetch<CycleVelocityTrendResult | null>(
    () =>
      gqlQuery<CycleVelocityTrendResult>(
        CYCLE_VELOCITY_TREND_QUERY,
        { input: { teamId } },
        'analyticsCycleVelocityTrend',
      ),
    [teamId],
    null,
  );

  const chartData = useMemo(() => {
    if (!data) {
      return [];
    }
    const last8 = data.cycles.slice(-8);
    return last8.map(c => ({
      label: `#${c.cycleNumber}`,
      value: mode === 'issues' ? c.completedIssues : Math.round(c.completedPoints),
    }));
  }, [data, mode]);

  const rolling3 = mode === 'issues' ? (data?.rolling3 ?? 0) : (data?.rolling3Points ?? 0);
  const rolling6 = mode === 'issues' ? (data?.rolling6 ?? 0) : (data?.rolling6Points ?? 0);
  const rolling12 = mode === 'issues' ? (data?.rolling12 ?? 0) : (data?.rolling12Points ?? 0);

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t('analytics.velocity.title')}</h2>
        <SegmentedControl
          onChange={setMode}
          options={[
            { label: t('analytics.velocity.issues'), value: 'issues' },
            { label: t('analytics.velocity.points'), value: 'points' },
          ]}
          value={mode}
        />
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t('analytics.velocity.loading')}</p>
      ) : error ? (
        <InlineRetry message={t('analytics.workspace.failedToLoad')} onRetry={refetch} />
      ) : (
        <>
          <div className="mb-3 rounded-lg border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-medium text-foreground">
              {mode === 'issues'
                ? t('analytics.velocity.completedIssuesPerCycle')
                : t('analytics.velocity.completedPointsPerCycle')}
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t('analytics.velocity.last8Cycles')}
            </p>
            <VelocityBarChart data={chartData} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <RollingCard label={t('analytics.velocity.avg3Cycle')} value={rolling3} />
            <RollingCard label={t('analytics.velocity.avg6Cycle')} value={rolling6} />
            <RollingCard label={t('analytics.velocity.avg12Cycle')} value={rolling12} />
          </div>
        </>
      )}
    </div>
  );
}
