'use client';

import { useState } from 'react';
import {
  CHART_HEIGHT,
  makeScales,
  PADDING_BOTTOM,
  PADDING_LEFT,
  PADDING_RIGHT,
  toPath,
  xAxisLabels,
  xAxisStep,
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

/** Axis never grows past this many days, whatever a forecast or target says. */
const MAX_AXIS_POINTS = 800;
const DAY_MS = 86_400_000;

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Series days, then every day up to the later of the projected finish and the target. */
export function buildAxis(data: ProjectBurnupData): string[] {
  const axis = data.points.map(p => p.date);
  const last = axis[axis.length - 1];
  if (!last) {
    return axis;
  }
  const ends = [data.forecast.projectedFinish, data.targetDate].filter(
    (d): d is string => !!d && d > last,
  );
  const end = ends.sort().at(-1);
  if (!end) {
    return axis;
  }
  const span = Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / DAY_MS,
  );
  for (let i = 1; i <= span && axis.length < MAX_AXIS_POINTS; i++) {
    axis.push(addDays(last, i));
  }
  return axis;
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

  const scopePath = toPath(pts.map((p, i) => ({ x: xScale(i), y: yScale(p.scope) })));
  const donePath = toPath(pts.map((p, i) => ({ x: xScale(i), y: yScale(p.completed) })));
  const lastIdx = pts.length - 1;
  const finishIdx = data.forecast.projectedFinish
    ? axis.indexOf(data.forecast.projectedFinish)
    : -1;
  const forecastPath =
    data.forecast.status === 'projected' && finishIdx > lastIdx
      ? toPath([
          { x: xScale(lastIdx), y: yScale(pts[lastIdx].completed) },
          { x: xScale(finishIdx), y: yScale(pts[lastIdx].scope) },
        ])
      : null;
  const targetIdx = data.targetDate ? axis.indexOf(data.targetDate) : -1;
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

  const legend = [
    { dash: undefined, label: t('projects.burnup.scope'), stroke: 'var(--chart-primary)' },
    { dash: undefined, label: t('projects.burnup.completed'), stroke: 'var(--chart-actual)' },
    ...(forecastPath
      ? [{ dash: '5 4', label: t('projects.burnup.forecast'), stroke: 'var(--chart-actual)' }]
      : []),
    ...(targetIdx >= 0
      ? [{ dash: '2 3', label: t('projects.burnup.target'), stroke: 'var(--chart-warning)' }]
      : []),
  ];

  return (
    <div className="w-full" ref={ref}>
      <svg
        aria-label={t('projects.burnup.ariaLabel')}
        height={CHART_HEIGHT}
        onPointerLeave={() => setHover(null)}
        onPointerMove={onMove}
        role="img"
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
            textAnchor="middle"
            x={xScale(i)}
            y={CHART_HEIGHT - PADDING_BOTTOM + 14}
          >
            {label}
          </text>
        ))}
        {targetIdx >= 0 && (
          <line
            stroke="var(--chart-warning)"
            strokeDasharray="2 3"
            strokeWidth={2}
            x1={xScale(targetIdx)}
            x2={xScale(targetIdx)}
            y1={yScale(maxY)}
            y2={yScale(0)}
          />
        )}
        <path d={scopePath} fill="none" stroke="var(--chart-primary)" strokeWidth={2} />
        <path d={donePath} fill="none" stroke="var(--chart-actual)" strokeWidth={2} />
        {forecastPath && (
          <path
            d={forecastPath}
            fill="none"
            stroke="var(--chart-actual)"
            strokeDasharray="5 4"
            strokeWidth={2}
          />
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
      </svg>
      <p aria-live="off" className="mt-1 h-4 px-1 text-xs tabular-nums text-muted-foreground">
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
            <svg aria-hidden="true" height="8" width="18">
              <line
                stroke={item.stroke}
                strokeDasharray={item.dash}
                strokeWidth={2}
                x1="0"
                x2="18"
                y1="4"
                y2="4"
              />
            </svg>
            {item.label}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{t('projects.burnup.ariaLabel')}</caption>
        <tbody>
          {pts.map(p => (
            <tr key={p.date}>
              <th scope="row">{fmt(p.date)}</th>
              <td>{`${t('projects.burnup.scope')} ${p.scope}`}</td>
              <td>{`${t('projects.burnup.completed')} ${p.completed}`}</td>
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
