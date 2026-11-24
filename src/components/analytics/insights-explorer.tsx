'use client';

import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionCard } from '@/components/shared/section-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SimpleSelect } from '@/components/ui/select';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { downloadCsv, rowsToCsv } from '@/lib/csv-export';
import { csvSafeText } from '@/lib/csv-safe';
import { gqlQuery } from '@/lib/graphql';
import {
  INSIGHT_MEASURES,
  INSIGHT_SLICES,
  INSIGHTS_SCAN_LIMIT,
  type InsightMeasure,
  type InsightSlice,
  NONE_KEY,
  showsIssueCountColumn,
} from '@/lib/insights-aggregate';

interface Row {
  issueCount: number;
  key: string;
  label: string;
  sampleSize: number;
  value: number;
}

interface InsightsData {
  issueCount: number;
  rows: Row[];
  scanCapped: boolean;
  totalGroups: number;
  truncated: boolean;
}

interface ViewOption {
  id: string;
  name: string;
}

const INSIGHTS_QUERY = `
  query InsightsExplorer($measure: String!, $slice: String!, $viewId: ID) {
    insights(measure: $measure, slice: $slice, viewId: $viewId) {
      issueCount totalGroups truncated scanCapped
      rows { key label value issueCount sampleSize }
    }
  }
`;
const VIEWS_QUERY = `query InsightsViews { customViews { id name } }`;
const ALL = '';

/**
 * Insights v0: choose a Measure and a Slice (and optionally a saved view to
 * narrow the issues), get a bar chart and the same numbers as a table with CSV
 * export. The server only counts issues the viewer can see.
 */
export function InsightsExplorer() {
  const t = useTranslations();
  const [measure, setMeasure] = useState<InsightMeasure>('count');
  const [slice, setSlice] = useState<InsightSlice>('status');
  const [viewId, setViewId] = useState(ALL);

  const views = useRetryableFetch<ViewOption[]>(
    async () => (await gqlQuery<ViewOption[]>(VIEWS_QUERY, {}, 'customViews')) ?? [],
    [],
    [],
  );
  const { data, loading, error, refetch } = useRetryableFetch<InsightsData | null>(
    () =>
      gqlQuery<InsightsData>(
        INSIGHTS_QUERY,
        { measure, slice, viewId: viewId || null },
        'insights',
      ),
    [measure, slice, viewId],
    null,
  );

  const groupLabel = (row: Row): string => {
    if (row.key === NONE_KEY) {
      return t(`analytics.explorer.none.${slice}`);
    }
    if (slice === 'priority') {
      return t(`analytics.explorer.priority.${row.key}`);
    }
    return row.label;
  };
  const fmtValue = (v: number): string =>
    measure === 'cycleTime'
      ? t('analytics.explorer.days', { count: v })
      : String(Math.round(v * 10) / 10);
  const max = useMemo(() => Math.max(1, ...(data?.rows ?? []).map(r => r.value)), [data]);
  const capNote = (
    <p className="mt-2 text-xs text-warning-subtle-foreground" role="note">
      {t('analytics.explorer.scanCapped', { count: INSIGHTS_SCAN_LIMIT.toLocaleString() })}
    </p>
  );
  const showIssues = showsIssueCountColumn(measure);
  const valueHeader = t(`analytics.explorer.valueHeader.${measure}`);

  const exportCsv = () => {
    if (!data) {
      return;
    }
    const csv = rowsToCsv(
      [
        t(`analytics.explorer.slices.${slice}`),
        valueHeader,
        ...(measure === 'cycleTime' ? [t('analytics.explorer.sampleHeader')] : []),
        ...(showIssues ? [t('analytics.explorer.issues')] : []),
      ],
      data.rows.map(r => [
        csvSafeText(groupLabel(r)),
        r.value,
        ...(measure === 'cycleTime' ? [r.sampleSize] : []),
        ...(showIssues ? [r.issueCount] : []),
      ]),
    );
    downloadCsv(`insights-${measure}-by-${slice}`, csv);
  };

  return (
    <SectionCard
      as="h2"
      className="mt-5"
      description={t('analytics.explorer.description')}
      title={t('analytics.explorer.title')}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="insights-controls">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('analytics.explorer.measure')}</span>
          <SegmentedControl
            onChange={setMeasure}
            options={INSIGHT_MEASURES.map(m => ({
              label: t(`analytics.explorer.measures.${m}`),
              value: m,
            }))}
            value={measure}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('analytics.explorer.slice')}</span>
          <SimpleSelect
            ariaLabel={t('analytics.explorer.slice')}
            onChange={v => setSlice(v as InsightSlice)}
            options={INSIGHT_SLICES.map(s => ({
              label: t(`analytics.explorer.slices.${s}`),
              value: s,
            }))}
            value={slice}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('analytics.explorer.filter')}</span>
          <SimpleSelect
            ariaLabel={t('analytics.explorer.filter')}
            onChange={setViewId}
            options={[
              { label: t('analytics.explorer.allIssues'), value: ALL },
              ...views.data.map(v => ({ label: v.name, value: v.id })),
            ]}
            value={viewId}
          />
        </div>
      </div>

      <div className="mt-4">
        {loading && (
          <LoadingRegion>
            <Skeleton className="h-48" />
          </LoadingRegion>
        )}
        {error && (
          <InlineRetry message={t('analytics.explorer.failedToLoad')} onRetry={() => refetch()} />
        )}
        {data && !loading && data.rows.length === 0 && (
          <>
            <EmptyState size="compact" title={t('analytics.explorer.empty')} />
            {data.scanCapped && capNote}
          </>
        )}
        {data && !loading && data.rows.length > 0 && (
          <>
            <div aria-hidden="true" className="flex flex-col gap-2" data-testid="insights-bars">
              {data.rows.map(r => (
                <div className="flex items-center gap-2" key={r.key}>
                  <span
                    className="w-28 shrink-0 truncate text-xs text-muted-foreground sm:w-40"
                    title={groupLabel(r)}
                  >
                    {groupLabel(r)}
                  </span>
                  <div className="h-5 flex-1 rounded bg-muted">
                    <div
                      className="h-5 rounded"
                      style={{
                        backgroundColor: 'var(--chart-primary)',
                        width: `${Math.max(2, (r.value / max) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtValue(r.value)}
                  </span>
                  {measure === 'cycleTime' && (
                    <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {t('analytics.explorer.sampleShort', { count: r.sampleSize })}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {t('analytics.explorer.summary', {
                  count: data.issueCount,
                  groups: t('analytics.explorer.groupCount', { count: data.totalGroups }),
                  issues: data.issueCount,
                })}
                {slice === 'label' && ` ${t('analytics.explorer.labelNote')}`}
              </p>
              <Button onClick={exportCsv} size="sm" type="button" variant="outline">
                <Download className="mr-1 h-3.5 w-3.5" />
                {t('analytics.explorer.exportCsv')}
              </Button>
            </div>
            {data.truncated && (
              <p className="mt-1 text-xs text-warning-subtle-foreground" role="note">
                {t('analytics.explorer.truncated', { count: data.rows.length })}
              </p>
            )}
            {data.scanCapped && capNote}
            {measure === 'cycleTime' && (
              <p className="mt-1 text-xs text-muted-foreground" role="note">
                {t('analytics.explorer.cycleTimeNote')}
              </p>
            )}

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm">
                <caption className="sr-only">
                  {t('analytics.explorer.tableCaption', {
                    measure: t(`analytics.explorer.measures.${measure}`),
                    slice: t(`analytics.explorer.slices.${slice}`),
                  })}
                </caption>
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pr-2 font-medium" scope="col">
                      {t(`analytics.explorer.slices.${slice}`)}
                    </th>
                    <th className="py-2 px-2 text-right font-medium" scope="col">
                      {valueHeader}
                    </th>
                    {measure === 'cycleTime' && (
                      <th className="py-2 px-2 text-right font-medium" scope="col">
                        {t('analytics.explorer.sampleHeader')}
                      </th>
                    )}
                    {showIssues && (
                      <th className="py-2 pl-2 text-right font-medium" scope="col">
                        {t('analytics.explorer.issues')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map(r => (
                    <tr key={r.key}>
                      <th
                        className="max-w-[16rem] truncate py-2 pr-2 text-left font-normal text-foreground"
                        scope="row"
                      >
                        {groupLabel(r)}
                      </th>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-foreground">
                        {fmtValue(r.value)}
                      </td>
                      {measure === 'cycleTime' && (
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">
                          {r.sampleSize}
                        </td>
                      )}
                      {showIssues && (
                        <td className="py-2 pl-2 text-right font-mono tabular-nums text-muted-foreground">
                          {r.issueCount}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
