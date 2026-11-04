'use client';

import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import {
  CHART_HEIGHT,
  makeScales,
  PADDING_BOTTOM,
  PADDING_LEFT,
  PADDING_RIGHT,
  toPath,
  xAxisLabels,
  xAxisStep,
} from './chart-geometry';
import { useChartWidth } from './use-chart-width';

interface BurnupPoint {
  completed: number;
  date: string;
  scope: number;
}

interface BurnupChartProps {
  data: BurnupPoint[];
}

export function BurnupChart({ data }: BurnupChartProps) {
  const t = useTranslations();
  const { formatDate } = useFormatters();
  const { ref, width } = useChartWidth();

  if (data.length === 0) {
    return (
      <div ref={ref}>
        <p className="py-6 text-center text-xs text-muted-foreground">{t('cycles.burnup.empty')}</p>
      </div>
    );
  }

  const finalScope = data[data.length - 1].scope;
  const maxY = Math.max(finalScope, 1);
  const n = data.length;

  const { xScale, yScale, yTicks } = makeScales(n, maxY, width);

  // Ideal: linear from 0 to finalScope over the cycle duration.
  // For a single data point (1-day cycle) the ideal is finalScope (all done by end of day).
  const idealPath = toPath(
    data.map((_, i) => ({
      x: xScale(i),
      y: yScale(n === 1 ? finalScope : (finalScope / (n - 1)) * i),
    })),
  );
  const scopePath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.scope) })));
  const completedPath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.completed) })));

  const fmt = (date: string) => formatDate(date, { day: 'numeric', month: 'short' });
  const xLabels = xAxisLabels(data, fmt, xAxisStep(n, width));

  return (
    <div className="w-full" ref={ref}>
      <svg
        aria-label={t('cycles.burnup.ariaLabel')}
        height={CHART_HEIGHT}
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
                x={PADDING_LEFT - 4}
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
            textAnchor="middle"
            x={xScale(i)}
            y={CHART_HEIGHT - PADDING_BOTTOM + 14}
          >
            {label}
          </text>
        ))}

        {/* Ideal line (gray dashed) */}
        <path
          d={idealPath}
          fill="none"
          stroke="var(--chart-grid)"
          strokeDasharray="4 3"
          strokeWidth={1.5}
        />

        {/* Scope line (blue) */}
        <path d={scopePath} fill="none" stroke="var(--chart-primary)" strokeWidth={2} />

        {/* Completed line (green) */}
        <path d={completedPath} fill="none" stroke="var(--chart-actual)" strokeWidth={2} />
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        {[
          { dash: true, label: t('cycles.chart.ideal'), stroke: 'var(--chart-grid)' },
          { dash: false, label: t('cycles.chart.scope'), stroke: 'var(--chart-primary)' },
          { dash: false, label: t('cycles.chart.completed'), stroke: 'var(--chart-actual)' },
        ].map(item => (
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
        <caption>{t('cycles.burnup.ariaLabel')}</caption>
        <tbody>
          {data.map(d => (
            <tr key={d.date}>
              <th scope="row">{fmt(d.date)}</th>
              <td>{`${t('cycles.chart.scope')} ${d.scope}`}</td>
              <td>{`${t('cycles.chart.completed')} ${d.completed}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
