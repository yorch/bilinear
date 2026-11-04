'use client';

import { useState } from 'react';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import {
  CHART_HEIGHT,
  makeScales,
  PADDING_BOTTOM,
  PADDING_LEFT,
  PADDING_RIGHT,
  PADDING_TOP,
  toPath,
  xAxisLabels,
  xAxisStep,
} from './chart-geometry';
import { useChartWidth } from './use-chart-width';

interface BurndownPoint {
  completed: number;
  date: string;
  remaining: number;
  scope: number;
}

interface BurndownChartProps {
  data: BurndownPoint[];
}

export function BurndownChart({ data }: BurndownChartProps) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const { ref, width } = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div ref={ref}>
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t('cycles.burndown.empty')}
        </p>
      </div>
    );
  }

  const initialScope = data[0].scope;
  const maxY = Math.max(...data.map(d => Math.max(d.remaining, d.scope)), 1);
  const n = data.length;
  const scopeChanged = data.some(d => d.scope !== initialScope);

  const { xScale, yScale, yTicks } = makeScales(n, maxY, width);

  // Ideal burndown: linear from initialScope on day 0 to 0 on the last day.
  const idealPath = toPath(
    data.map((_, i) => ({
      x: xScale(i),
      y: yScale(n === 1 ? 0 : initialScope - (initialScope / (n - 1)) * i),
    })),
  );

  const remainingPath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.remaining) })));
  const scopePath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.scope) })));

  const fmt = (date: string) => formatDate(date, { day: 'numeric', month: 'short' });
  const xLabels = xAxisLabels(data, fmt, xAxisStep(n, width));

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(xScale(i) - x) < Math.abs(xScale(best) - x)) {
        best = i;
      }
    }
    setHover(best);
  };

  const active = hover === null ? null : data[hover];
  // Keep the readout inside the plot: flip to the left of the cursor past the midpoint.
  const readoutX = hover === null ? 0 : xScale(hover);
  const flip = readoutX > width / 2;

  const legend = [
    { dash: true, label: t('cycles.chart.ideal'), stroke: 'var(--chart-grid)' },
    { dash: false, label: t('cycles.chart.remaining'), stroke: 'var(--chart-primary)' },
    ...(scopeChanged
      ? [{ dash: false, label: t('cycles.chart.scope'), stroke: 'var(--chart-warning)' }]
      : []),
  ];

  return (
    <div className="w-full" ref={ref}>
      <svg
        aria-label={t('cycles.burndown.ariaLabel')}
        height={CHART_HEIGHT}
        onPointerLeave={() => setHover(null)}
        onPointerMove={handleMove}
        role="img"
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        width={width}
      >
        {/* Y-axis grid lines + labels */}
        {yTicks.map(v => {
          const y = yScale(v);
          return (
            <g key={v}>
              <line
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
                x1={PADDING_LEFT}
                x2={width - PADDING_RIGHT}
                y1={y}
                y2={y}
              />
              <text
                className="fill-muted-foreground"
                fontSize={11}
                textAnchor="end"
                x={PADDING_LEFT - 6}
                y={y + 4}
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {xLabels.map(({ i, label }) => (
          <text
            className="fill-muted-foreground"
            fontSize={11}
            key={i}
            textAnchor={i === n - 1 && i > 0 ? 'end' : 'middle'}
            x={xScale(i)}
            y={CHART_HEIGHT - PADDING_BOTTOM + 16}
          >
            {label}
          </text>
        ))}

        {/* Ideal burndown line (gray dashed) */}
        <path
          d={idealPath}
          fill="none"
          stroke="var(--chart-grid)"
          strokeDasharray="4 3"
          strokeWidth={1.5}
        />

        {/* Scope line: without it, scope added mid-cycle reads as "remaining spiked". */}
        {scopeChanged && (
          <path
            d={scopePath}
            fill="none"
            stroke="var(--chart-warning)"
            strokeDasharray="2 2"
            strokeWidth={1.5}
          />
        )}

        {/* Remaining line */}
        <path d={remainingPath} fill="none" stroke="var(--chart-primary)" strokeWidth={2} />

        {hover !== null && active && (
          <g pointerEvents="none">
            <line
              stroke="var(--chart-grid)"
              strokeWidth={1}
              x1={readoutX}
              x2={readoutX}
              y1={PADDING_TOP}
              y2={CHART_HEIGHT - PADDING_BOTTOM}
            />
            <circle
              cx={readoutX}
              cy={yScale(active.remaining)}
              fill="var(--chart-primary)"
              r={3.5}
            />
            <text
              className="fill-foreground"
              fontSize={11}
              textAnchor={flip ? 'end' : 'start'}
              x={readoutX + (flip ? -8 : 8)}
              y={PADDING_TOP + 12}
            >
              {`${fmt(active.date)} · ${t('cycles.chart.remaining')} ${active.remaining} · ${t('cycles.chart.scope')} ${active.scope}`}
            </text>
          </g>
        )}
      </svg>

      {/* Legend lives in HTML so it wraps and keeps real text size on phones. */}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        {legend.map(item => (
          <li className="flex items-center gap-1.5" key={item.label}>
            <svg aria-hidden="true" height="8" width="18">
              <line
                stroke={item.stroke}
                strokeDasharray={item.dash ? '4 3' : undefined}
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

      {/* The chart is a picture; this is the same data for assistive tech. */}
      <table className="sr-only">
        <caption>{t('cycles.burndown.ariaLabel')}</caption>
        <tbody>
          {data.map(d => (
            <tr key={d.date}>
              <th scope="row">{fmt(d.date)}</th>
              <td>{`${t('cycles.chart.remaining')} ${d.remaining}`}</td>
              <td>{`${t('cycles.chart.scope')} ${d.scope}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
