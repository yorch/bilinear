'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';

interface HistogramBucket {
  bucketEnd: number;
  bucketStart: number;
  count: number;
}

interface ThroughputPoint {
  count: number;
  weekStart: string;
}

interface TimeInStateRow {
  avgHours: number;
  sampleSize: number;
  stateId: string;
}

interface InsightsData {
  cycle: HistogramBucket[];
  lead: HistogramBucket[];
  throughput: ThroughputPoint[];
  timeInState: TimeInStateRow[];
}

interface InsightsSectionProps {
  onPresetChange?: (preset: RangePreset) => void;
  preset?: RangePreset;
  states: Array<{ color: string; id: string; name: string }>;
  teamId: string;
}

const INSIGHTS_QUERY = `
  query Insights($input: AnalyticsInput) {
    analyticsLeadTimeHistogram(input: $input) { bucketStart bucketEnd count }
    analyticsCycleTimeHistogram(input: $input) { bucketStart bucketEnd count }
    analyticsThroughputByWeek(input: $input) { weekStart count }
    analyticsTimeInState(input: $input) { stateId avgHours sampleSize }
  }
`;

type RangePreset = '30d' | '90d' | '180d' | 'all';

const PRESETS: Array<{ value: RangePreset }> = [
  { value: '30d' },
  { value: '90d' },
  { value: '180d' },
  { value: 'all' },
];

function rangeForPreset(preset: RangePreset): { from?: string; to?: string } {
  if (preset === 'all') {
    return {};
  }
  const days = { '30d': 30, '90d': 90, '180d': 180 }[preset];
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString().split('T')[0] };
}

function fmtBucketLabel(b: HistogramBucket): string {
  if (b.bucketEnd === Number.POSITIVE_INFINITY || !Number.isFinite(b.bucketEnd)) {
    return `${b.bucketStart}d+`;
  }
  return `${b.bucketStart}–${b.bucketEnd}d`;
}

function Histogram({ buckets, color }: { buckets: HistogramBucket[]; color: string }) {
  const t = useTranslations();
  const max = Math.max(...buckets.map(b => b.count), 1);
  if (buckets.every(b => b.count === 0)) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {t('analytics.insights.noCompletedIssuesInRange')}
      </p>
    );
  }
  return (
    <div className="flex h-32 items-end gap-1.5">
      {buckets.map(b => {
        const pct = (b.count / max) * 100;
        return (
          <div
            className="flex flex-1 flex-col items-center gap-1"
            key={`${b.bucketStart}-${b.bucketEnd}`}
          >
            <span className="text-[10px] font-medium text-muted-foreground">
              {b.count > 0 ? b.count : ''}
            </span>
            <div
              className="w-full rounded-t transition-all"
              style={{
                backgroundColor: color,
                height: `${Math.max(pct, b.count > 0 ? 4 : 0)}%`,
                minHeight: b.count > 0 ? '4px' : '0',
              }}
            />
            <span className="truncate text-[10px] text-muted-foreground">{fmtBucketLabel(b)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  const t = useTranslations();
  if (points.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {t('analytics.insights.noThroughputDataInRange')}
      </p>
    );
  }
  const max = Math.max(...points.map(p => p.count), 1);
  return (
    <div className="flex h-32 items-end gap-1">
      {points.map(p => {
        const pct = (p.count / max) * 100;
        return (
          <div className="flex flex-1 flex-col items-center gap-1" key={p.weekStart}>
            <div
              className="w-full rounded-t bg-indigo-500 transition-all"
              style={{
                height: `${Math.max(pct, 4)}%`,
                minHeight: '4px',
              }}
              title={t('analytics.insights.completedWeekOf', {
                count: p.count,
                weekStart: p.weekStart,
              })}
            />
          </div>
        );
      })}
    </div>
  );
}

function TimeInStateChart({
  rows,
  states,
}: {
  rows: TimeInStateRow[];
  states: Array<{ color: string; id: string; name: string }>;
}) {
  const t = useTranslations();
  const stateById = new Map(states.map(s => [s.id, s]));
  const visible = rows
    .filter(r => stateById.has(r.stateId))
    .sort((a, b) => b.avgHours - a.avgHours);
  if (visible.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        {t('analytics.insights.noStateTransitionData')}
      </p>
    );
  }
  const max = Math.max(...visible.map(r => r.avgHours), 1);
  return (
    <div className="flex flex-col gap-2">
      {visible.map(row => {
        const state = stateById.get(row.stateId);
        if (!state) {
          return null;
        }
        const pct = (row.avgHours / max) * 100;
        return (
          <div className="flex items-center gap-2" key={row.stateId}>
            <span
              className="w-24 shrink-0 truncate text-xs text-muted-foreground"
              title={state.name}
            >
              {state.name}
            </span>
            <div className="flex-1 rounded bg-muted">
              <div
                className="h-4 rounded transition-all"
                style={{
                  backgroundColor: state.color,
                  width: `${Math.max(pct, 2)}%`,
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-right text-xs font-medium text-muted-foreground">
              {row.avgHours < 24
                ? `${row.avgHours.toFixed(1)}h`
                : `${(row.avgHours / 24).toFixed(1)}d`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InsightsSection({
  onPresetChange,
  preset: presetProp,
  states,
  teamId,
}: InsightsSectionProps) {
  const t = useTranslations();
  const [localPreset, setLocalPreset] = useState<RangePreset>(presetProp ?? '90d');
  const preset = presetProp ?? localPreset;
  const setPreset = (p: RangePreset) => {
    setLocalPreset(p);
    onPresetChange?.(p);
  };
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  const input = useMemo(() => ({ teamId, ...rangeForPreset(preset) }), [preset, teamId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void gql(INSIGHTS_QUERY, { input }).then(res => {
      if (cancelled) {
        return;
      }
      if (res.data) {
        const d = res.data as unknown as {
          analyticsCycleTimeHistogram: HistogramBucket[];
          analyticsLeadTimeHistogram: HistogramBucket[];
          analyticsThroughputByWeek: ThroughputPoint[];
          analyticsTimeInState: TimeInStateRow[];
        };
        setData({
          cycle: d.analyticsCycleTimeHistogram,
          lead: d.analyticsLeadTimeHistogram,
          throughput: d.analyticsThroughputByWeek,
          timeInState: d.analyticsTimeInState,
        });
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [input]);

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {t('analytics.insights.title')}
        </h2>
        <div className="flex rounded-md border border-border p-0.5">
          {PRESETS.map(p => (
            <button
              className={
                preset === p.value
                  ? 'rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'px-2 py-0.5 text-xs text-zinc-500 hover:text-foreground'
              }
              key={p.value}
              onClick={() => setPreset(p.value)}
              type="button"
            >
              {p.value === 'all' ? t('analytics.insights.rangeAll') : p.value}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t('analytics.insights.loading')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {t('analytics.insights.leadTime')}
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t('analytics.insights.leadTimeSubtitle')}
            </p>
            <Histogram buckets={data?.lead ?? []} color="var(--chart-ideal)" />
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {t('analytics.insights.cycleTime')}
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t('analytics.insights.cycleTimeSubtitle')}
            </p>
            <Histogram buckets={data?.cycle ?? []} color="#10b981" />
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {t('analytics.insights.throughputTrend')}
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t('analytics.insights.throughputTrendSubtitle')}
            </p>
            <ThroughputChart points={data?.throughput ?? []} />
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h3 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {t('analytics.insights.avgTimeInState')}
            </h3>
            <p className="mb-3 text-[11px] text-muted-foreground">
              {t('analytics.insights.avgTimeInStateSubtitle')}
            </p>
            <TimeInStateChart rows={data?.timeInState ?? []} states={states} />
          </div>
        </div>
      )}
    </div>
  );
}
