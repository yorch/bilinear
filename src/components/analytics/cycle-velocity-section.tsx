'use client';

import { useEffect, useMemo, useState } from 'react';
import { gql } from '@/lib/graphql';

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

const CYCLE_VELOCITY_QUERY = `
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
  const max = Math.max(...data.map(d => d.value), 1);

  if (data.length === 0 || data.every(d => d.value === 0)) {
    return <p className="py-8 text-center text-sm text-zinc-400">No completed cycles yet</p>;
  }

  return (
    <div className="flex h-36 items-end gap-2">
      {data.map(item => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={item.label}>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
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
// Rolling average stat card
// ---------------------------------------------------------------------------

interface RollingCardProps {
  label: string;
  value: number;
}

function RollingCard({ label, value }: RollingCardProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
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
  const [data, setData] = useState<CycleVelocityTrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<MetricMode>('issues');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void gql(CYCLE_VELOCITY_QUERY, { input: { teamId } })
      .then(res => {
        if (cancelled) {
          return;
        }
        if (res.data) {
          const d = res.data as unknown as {
            analyticsCycleVelocityTrend: CycleVelocityTrendResult;
          };
          setData(d.analyticsCycleVelocityTrend);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

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
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Cycle Velocity</h2>
        <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
          {(['issues', 'points'] as MetricMode[]).map(m => (
            <button
              className={
                mode === m
                  ? 'rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
              }
              key={m}
              onClick={() => setMode(m)}
              type="button"
            >
              {m === 'issues' ? 'Issues' : 'Points'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-400">Loading cycle velocity…</p>
      ) : (
        <>
          <div className="mb-3 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {mode === 'issues' ? 'Completed issues per cycle' : 'Completed points per cycle'}
            </h3>
            <p className="mb-3 text-[11px] text-zinc-400">Last 8 completed cycles</p>
            <VelocityBarChart data={chartData} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <RollingCard label="3-cycle avg" value={rolling3} />
            <RollingCard label="6-cycle avg" value={rolling6} />
            <RollingCard label="12-cycle avg" value={rolling12} />
          </div>
        </>
      )}
    </div>
  );
}
