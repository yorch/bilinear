import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  makeScales,
  PADDING_BOTTOM,
  PADDING_LEFT,
  PADDING_RIGHT,
  PADDING_TOP,
  toPath,
  xAxisLabels,
} from './chart-geometry';

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

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">{t('cycles.burndown.empty')}</p>
    );
  }

  const initialScope = data[0].scope;
  const maxY = Math.max(...data.map(d => Math.max(d.remaining, d.scope)), 1);
  const n = data.length;

  const { xScale, yScale, yTicks } = makeScales(n, maxY);

  // Ideal burndown: linear from initialScope on day 0 to 0 on the last day.
  const idealPath = toPath(
    data.map((_, i) => ({
      x: xScale(i),
      y: yScale(n === 1 ? 0 : initialScope - (initialScope / (n - 1)) * i),
    })),
  );

  const remainingPath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.remaining) })));

  const xLabels = xAxisLabels(data, date => formatDate(date, { day: 'numeric', month: 'short' }));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        aria-label={t('cycles.burndown.ariaLabel')}
        className="w-full"
        style={{ height: CHART_HEIGHT }}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
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
                x2={CHART_WIDTH - PADDING_RIGHT}
                y1={y}
                y2={y}
              />
              <text
                className="fill-muted-foreground"
                fontSize={10}
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
            fontSize={9}
            key={i}
            textAnchor="middle"
            x={xScale(i)}
            y={CHART_HEIGHT - PADDING_BOTTOM + 14}
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

        {/* Remaining line (indigo) */}
        <path d={remainingPath} fill="none" stroke="var(--chart-ideal)" strokeWidth={2} />

        {/* Legend */}
        <g transform={`translate(${PADDING_LEFT + 8}, ${PADDING_TOP + 8})`}>
          <line
            stroke="var(--chart-grid)"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            x1={0}
            x2={16}
            y1={5}
            y2={5}
          />
          <text className="fill-muted-foreground" fontSize={9} x={20} y={9}>
            {t('cycles.chart.ideal')}
          </text>
          <line stroke="var(--chart-ideal)" strokeWidth={2} x1={50} x2={66} y1={5} y2={5} />
          <text className="fill-muted-foreground" fontSize={9} x={70} y={9}>
            {t('cycles.chart.remaining')}
          </text>
        </g>
      </svg>
    </div>
  );
}
