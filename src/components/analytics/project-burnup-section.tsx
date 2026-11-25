'use client';

import { useState } from 'react';
import { buildAxis, placeOnAxis } from '@/components/analytics/burnup-axis';
import {
  CHART_HEIGHT,
  makeScales,
  PADDING_BOTTOM,
  PADDING_LEFT,
  PADDING_RIGHT,
  toPath,
  xAxisLabels,
  xAxisStep,
  xLabelAnchor,
} from '@/components/cycles/chart-geometry';
import { useChartWidth } from '@/components/cycles/use-chart-width';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionCard } from '@/components/shared/section-card';
import { Badge } from '@/components/ui/badge';
import { LoadingRegion, Skeleton } from '@/components/ui/skeleton';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { daysBetween } from '@/lib/project-burnup';

interface Point {
  completed: number;
  date: string;
  scope: number;
}

export interface ProjectBurnupData {
  forecast: {
    projectedFinish: string | null;
    reason: string | null;
    remaining: number;
    status: 'complete' | 'insufficient' | 'projected';
    velocityPerDay: number;
    windowDays: number;
  };
  points: Point[];
  projectId: string;
  targetDate: string | null;
}

const QUERY = `
  query ProjectBurnup($projectId: ID!) {
    projectBurnup(projectId: $projectId) {
      projectId
      targetDate
      points { date scope completed }
      forecast { status projectedFinish reason remaining velocityPerDay windowDays }
    }
  }
`;

type MarkerKind = 'circle' | 'diamond' | 'square' | 'triangle';

/** A 8px mark with a 2px card-coloured ring so it stays legible over a line. */
function Marker({
  hollow,
  kind,
  stroke,
  x,
  y,
}: {
  hollow?: boolean;
  kind: MarkerKind;
  stroke: string;
  x: number;
  y: number;
}) {
  const common = {
    fill: hollow ? 'var(--card)' : stroke,
    stroke: hollow ? stroke : 'var(--card)',
    strokeWidth: 2,
  };
  switch (kind) {
    case 'circle':
      return <circle cx={x} cy={y} r={4} {...common} />;
    case 'square':
      return <rect height={8} width={8} x={x - 4} y={y - 4} {...common} />;
    case 'diamond':
      return (
        <rect
          height={8}
          transform={`rotate(45 ${x} ${y})`}
          width={8}
          x={x - 4}
          y={y - 4}
          {...common}
        />
      );
    case 'triangle':
      return <path d={`M ${x} ${y + 5} L ${x - 5} ${y - 4} L ${x + 5} ${y - 4} Z`} {...common} />;
  }
}

function BurnupChart({ data }: { data: ProjectBurnupData }) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  const axis = buildAxis(data);
  const n = axis.length;
  const pts = data.points;
  const maxY = Math.max(1, ...pts.map(p => p.scope));
  const { xScale, yScale, yTicks } = makeScales(n, maxY, width);
  const fmt = (d: string) => formatDate(d, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fmtYear = (d: string) =>
    formatDate(d, { day: 'numeric', month: 'short', timeZone: 'UTC', year: 'numeric' });

  const scopePath = toPath(pts.map((p, i) => ({ x: xScale(i), y: yScale(p.scope) })));
  const donePath = toPath(pts.map((p, i) => ({ x: xScale(i), y: yScale(p.completed) })));
  const lastIdx = pts.length - 1;
  const finish = placeOnAxis(data.forecast.projectedFinish, axis);
  const finishIdx = finish && !finish.clipped ? finish.index : -1;
  const forecastPath =
    data.forecast.status === 'projected' && finishIdx > lastIdx
      ? toPath([
          { x: xScale(lastIdx), y: yScale(pts[lastIdx].completed) },
          { x: xScale(finishIdx), y: yScale(pts[lastIdx].scope) },
        ])
      : null;
  // A target outside the axis is pinned to the nearest edge and says so,
  // rather than silently vanishing.
  const target = placeOnAxis(data.targetDate, axis);
  const targetLabel =
    data.targetDate && target?.clipped
      ? t(
          target.clipped === 'before'
            ? 'projects.burnup.targetBefore'
            : 'projects.burnup.targetAfter',
          { date: fmtYear(data.targetDate) },
        )
      : null;
  const xLabels = xAxisLabels(
    axis.map(date => ({ date })),
    fmt,
    xAxisStep(n, width),
  );
  const hovered = hover !== null && hover < pts.length ? pts[hover] : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = 0;
    for (let i = 0; i < pts.length; i++) {
      if (Math.abs(xScale(i) - x) < Math.abs(xScale(best) - x)) {
        best = i;
      }
    }
    setHover(best);
  };

  // Keyboard scrubbing: arrows step a day, Home/End jump to the ends, Escape
  // clears. The readout below is a polite live region, so a screen reader
  // hears each day as the cursor moves.
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const cur = hover ?? lastIdx;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') {
      next = Math.max(0, cur - 1);
    } else if (e.key === 'ArrowRight') {
      next = Math.min(lastIdx, cur + 1);
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = lastIdx;
    } else if (e.key === 'Escape') {
      setHover(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setHover(next);
    }
  };

  // Every series is distinguishable without colour: scope = solid + circle,
  // completed = solid + square, forecast = dashed + hollow diamond,
  // target = dotted + triangle.
  const legend = [
    {
      dash: undefined,
      label: t('projects.burnup.scope'),
      marker: 'circle',
      stroke: 'var(--chart-primary)',
    },
    {
      dash: undefined,
      label: t('projects.burnup.completed'),
      marker: 'square',
      stroke: 'var(--chart-actual)',
    },
    ...(forecastPath
      ? [
          {
            dash: '5 4',
            label: t('projects.burnup.forecast'),
            marker: 'diamond',
            stroke: 'var(--chart-actual)',
          },
        ]
      : []),
    ...(target
      ? [
          {
            dash: '2 3',
            label: t('projects.burnup.target'),
            marker: 'triangle',
            stroke: 'var(--chart-warning)',
          },
        ]
      : []),
  ];
  const lastPt = pts[lastIdx];
  const dotIdx = hover !== null && hover < pts.length ? hover : lastIdx;

  return (
    <div className="w-full" ref={ref}>
      <div
        aria-describedby="burnup-kbd-hint"
        aria-label={t('projects.burnup.ariaLabel')}
        aria-roledescription="chart"
        aria-valuemax={lastIdx}
        aria-valuemin={0}
        aria-valuenow={dotIdx}
        aria-valuetext={t('projects.burnup.hover', {
          completed: pts[dotIdx].completed,
          date: fmt(pts[dotIdx].date),
          scope: pts[dotIdx].scope,
        })}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onBlur={() => setHover(null)}
        onFocus={() => setHover(h => h ?? lastIdx)}
        onKeyDown={onKey}
        role="slider"
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          height={CHART_HEIGHT}
          onPointerLeave={() => setHover(null)}
          onPointerMove={onMove}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          width={width}
        >
          {yTicks.map(v => (
            <g key={v}>
              <line
                stroke="currentColor"
                strokeOpacity={0.08}
                x1={PADDING_LEFT}
                x2={width - PADDING_RIGHT}
                y1={yScale(v)}
                y2={yScale(v)}
              />
              <text
                className="fill-muted-foreground"
                fontSize={11}
                textAnchor="end"
                x={PADDING_LEFT - 4}
                y={yScale(v) + 4}
              >
                {v}
              </text>
            </g>
          ))}
          {xLabels.map(({ i, label }) => (
            <text
              className="fill-muted-foreground"
              fontSize={11}
              key={i}
              textAnchor={xLabelAnchor(i, axis.length)}
              x={xScale(i)}
              y={CHART_HEIGHT - PADDING_BOTTOM + 14}
            >
              {label}
            </text>
          ))}
          {target && (
            <>
              <line
                stroke="var(--chart-warning)"
                strokeDasharray="2 3"
                strokeWidth={2}
                x1={xScale(target.index)}
                x2={xScale(target.index)}
                y1={yScale(maxY)}
                y2={yScale(0)}
              />
              <Marker
                kind="triangle"
                stroke="var(--chart-warning)"
                x={xScale(target.index)}
                y={yScale(maxY)}
              />
              {targetLabel && (
                <text
                  className="fill-muted-foreground"
                  fontSize={11}
                  textAnchor={target.clipped === 'before' ? 'start' : 'end'}
                  x={xScale(target.index) + (target.clipped === 'before' ? 8 : -8)}
                  y={yScale(maxY) + 12}
                >
                  {`${target.clipped === 'before' ? '\u2190' : '\u2192'} ${targetLabel}`}
                </text>
              )}
            </>
          )}
          <path d={scopePath} fill="none" stroke="var(--chart-primary)" strokeWidth={2} />
          <path d={donePath} fill="none" stroke="var(--chart-actual)" strokeWidth={2} />
          {forecastPath && (
            <>
              <path
                d={forecastPath}
                fill="none"
                stroke="var(--chart-actual)"
                strokeDasharray="5 4"
                strokeWidth={2}
              />
              <Marker
                hollow
                kind="diamond"
                stroke="var(--chart-actual)"
                x={xScale(finishIdx)}
                y={yScale(lastPt.scope)}
              />
            </>
          )}
          {hover !== null && hovered && (
            <line
              stroke="var(--chart-grid)"
              x1={xScale(hover)}
              x2={xScale(hover)}
              y1={yScale(maxY)}
              y2={yScale(0)}
            />
          )}
          {/* Always-visible point markers: a one-day series has no line to see. */}
          <Marker
            kind="circle"
            stroke="var(--chart-primary)"
            x={xScale(dotIdx)}
            y={yScale(pts[dotIdx].scope)}
          />
          <Marker
            kind="square"
            stroke="var(--chart-actual)"
            x={xScale(dotIdx)}
            y={yScale(pts[dotIdx].completed)}
          />
        </svg>
      </div>
      <p className="sr-only" id="burnup-kbd-hint">
        {t('projects.burnup.keyboardHint')}
      </p>
      <p
        aria-live="polite"
        className="mt-1 h-4 px-1 text-xs tabular-nums text-muted-foreground"
        role="status"
      >
        {hovered
          ? t('projects.burnup.hover', {
              completed: hovered.completed,
              date: fmt(hovered.date),
              scope: hovered.scope,
            })
          : ''}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        {legend.map(item => (
          <li className="flex items-center gap-1.5" key={item.label}>
            <svg aria-hidden="true" height="12" width="22">
              <line
                stroke={item.stroke}
                strokeDasharray={item.dash}
                strokeWidth={2}
                x1="0"
                x2="22"
                y1="6"
                y2="6"
              />
              <Marker
                hollow={item.marker === 'diamond'}
                kind={item.marker as MarkerKind}
                stroke={item.stroke}
                x={11}
                y={6}
              />
            </svg>
            {item.label}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{t('projects.burnup.ariaLabel')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('projects.burnup.dateHeader')}</th>
            <th scope="col">{t('projects.burnup.scope')}</th>
            <th scope="col">{t('projects.burnup.completed')}</th>
          </tr>
        </thead>
        <tbody>
          {pts.map(p => (
            <tr key={p.date}>
              <th scope="row">{fmt(p.date)}</th>
              <td>{p.scope}</td>
              <td>{p.completed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ForecastSummary({ data }: { data: ProjectBurnupData }) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const fmt = (d: string) =>
    formatDate(d, { day: 'numeric', month: 'short', timeZone: 'UTC', year: 'numeric' });
  const f = data.forecast;

  if (f.status === 'complete') {
    return <Badge tone="success">{t('projects.burnup.complete')}</Badge>;
  }
  if (f.status === 'insufficient' || !f.projectedFinish) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="muted">{t('projects.burnup.notEnoughData')}</Badge>
        <span className="text-xs text-muted-foreground">
          {t(`projects.burnup.reason.${f.reason ?? 'tooShort'}`)}
        </span>
      </div>
    );
  }
  const slip = data.targetDate ? daysBetween(data.targetDate, f.projectedFinish) : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-foreground">
        {t('projects.burnup.projectedFinish', { date: fmt(f.projectedFinish) })}
      </span>
      {slip === null ? (
        <span className="text-xs text-muted-foreground">{t('projects.burnup.noTarget')}</span>
      ) : (
        <Badge tone={slip <= 0 ? 'success' : slip > 14 ? 'danger' : 'warning'}>
          {slip <= 0
            ? t('projects.burnup.aheadOfTarget', {
                count: -slip,
                date: fmt(data.targetDate as string),
              })
            : t('projects.burnup.pastTarget', {
                count: slip,
                date: fmt(data.targetDate as string),
              })}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">
        {t('projects.burnup.velocity', {
          count: Math.round(f.velocityPerDay * 7 * 10) / 10,
          days: f.windowDays,
        })}
      </span>
    </div>
  );
}

/** Scope-vs-completed burn-up with a linear forecast, for the project detail page. */
export function ProjectBurnupSection({ projectId }: { projectId: string }) {
  const t = useTranslations();
  const { data, loading, error, refetch } = useRetryableFetch<ProjectBurnupData | null>(
    () => gqlQuery<ProjectBurnupData>(QUERY, { projectId }, 'projectBurnup'),
    [projectId],
    null,
  );

  return (
    <SectionCard
      as="h2"
      className="mt-6"
      description={t('projects.burnup.description')}
      title={t('projects.burnup.title')}
    >
      {loading && (
        <LoadingRegion>
          <Skeleton className="h-64" />
        </LoadingRegion>
      )}
      {error && (
        <InlineRetry message={t('projects.burnup.failedToLoad')} onRetry={() => refetch()} />
      )}
      {data && (
        <div className="flex flex-col gap-3">
          <ForecastSummary data={data} />
          {data.points.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {t('projects.burnup.empty')}
            </p>
          ) : (
            <BurnupChart data={data} />
          )}
        </div>
      )}
    </SectionCard>
  );
}
