'use client';

import { useMemo, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionCard } from '@/components/shared/section-card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';

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

/**
 * `days` drives the button label through `analytics.insights.rangeDays` — the
 * `'30d'` value is the internal preset id, not display text, so it must never
 * be rendered directly (the `d` suffix spaces differently per locale).
 */
const PRESETS: Array<{ days: number | null; value: RangePreset }> = [
  { days: 30, value: '30d' },
  { days: 90, value: '90d' },
  { days: 180, value: '180d' },
  { days: null, value: 'all' },
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

function fmtBucketLabel(b: HistogramBucket, t: ReturnType<typeof useTranslations>): string {
  if (b.bucketEnd === Number.POSITIVE_INFINITY || !Number.isFinite(b.bucketEnd)) {
    return t('analytics.insights.bucketDaysPlus', { count: b.bucketStart });
  }
  return t('analytics.insights.bucketDaysRange', { from: b.bucketStart, to: b.bucketEnd });
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
            <span className="truncate text-[10px] text-muted-foreground">
              {fmtBucketLabel(b, t)}
            </span>
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
              className="w-full rounded-t bg-brand transition-all"
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
  const input = useMemo(() => ({ teamId, ...rangeForPreset(preset) }), [preset, teamId]);

  // A rejected read must not fall through to `?? []` on all four charts —
  // four charts confidently asserting the team shipped nothing.
  const { data, error, loading, refetch } = useRetryableFetch<InsightsData | null>(
    async () => {
      const d = await gqlQuery<{
        analyticsCycleTimeHistogram: HistogramBucket[];
        analyticsLeadTimeHistogram: HistogramBucket[];
        analyticsThroughputByWeek: ThroughputPoint[];
        analyticsTimeInState: TimeInStateRow[];
      }>(INSIGHTS_QUERY, { input });
      return {
        cycle: d.analyticsCycleTimeHistogram,
        lead: d.analyticsLeadTimeHistogram,
        throughput: d.analyticsThroughputByWeek,
        timeInState: d.analyticsTimeInState,
      };
    },
    [input],
    null,
  );

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t('analytics.insights.title')}</h2>
        <SegmentedControl
          onChange={setPreset}
          options={PRESETS.map(p => ({
            label:
              p.days === null
                ? t('analytics.insights.rangeAll')
                : t('analytics.insights.rangeDays', { count: p.days }),
            value: p.value,
          }))}
          value={preset}
        />
      </div>

      {loading ? (
        <RowsSkeleton count={4} />
      ) : error ? (
        <InlineRetry message={t('analytics.workspace.failedToLoad')} onRetry={refetch} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <SectionCard
            description={t('analytics.insights.leadTimeSubtitle')}
            title={t('analytics.insights.leadTime')}
          >
            <Histogram buckets={data?.lead ?? []} color="var(--chart-ideal)" />
          </SectionCard>

          <SectionCard
            description={t('analytics.insights.cycleTimeSubtitle')}
            title={t('analytics.insights.cycleTime')}
          >
            <Histogram buckets={data?.cycle ?? []} color="var(--chart-actual)" />
          </SectionCard>

          <SectionCard
            description={t('analytics.insights.throughputTrendSubtitle')}
            title={t('analytics.insights.throughputTrend')}
          >
            <ThroughputChart points={data?.throughput ?? []} />
          </SectionCard>

          <SectionCard
            description={t('analytics.insights.avgTimeInStateSubtitle')}
            title={t('analytics.insights.avgTimeInState')}
          >
            <TimeInStateChart rows={data?.timeInState ?? []} states={states} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}
