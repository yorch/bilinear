import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';

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
    return <p className="py-6 text-center text-xs text-zinc-400">{t('cycles.burndown.empty')}</p>;
  }

  const width = 600;
  const height = 300;
  const paddingLeft = 36;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 32;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const initialScope = data[0].scope;
  const maxY = Math.max(...data.map(d => Math.max(d.remaining, d.scope)), 1);
  const n = data.length;

  const xScale = (i: number) => paddingLeft + (n > 1 ? (i / (n - 1)) * chartWidth : chartWidth / 2);
  const yScale = (v: number) => paddingTop + chartHeight - (v / maxY) * chartHeight;

  const toPath = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Ideal burndown: linear from initialScope on day 0 to 0 on the last day.
  const idealPath = toPath(
    data.map((_, i) => ({
      x: xScale(i),
      y: yScale(n === 1 ? 0 : initialScope - (initialScope / (n - 1)) * i),
    })),
  );

  const remainingPath = toPath(data.map((d, i) => ({ x: xScale(i), y: yScale(d.remaining) })));

  const yTicks = [0, Math.round(maxY / 2), maxY];

  const xLabels = data
    .map((d, i) => ({
      i,
      label: formatDate(d.date, {
        day: 'numeric',
        month: 'short',
      }),
    }))
    .filter((_, i) => i % 3 === 0 || i === n - 1);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        aria-label={t('cycles.burndown.ariaLabel')}
        className="w-full"
        style={{ height: 300 }}
        viewBox={`0 0 ${width} ${height}`}
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
                x1={paddingLeft}
                x2={width - paddingRight}
                y1={y}
                y2={y}
              />
              <text
                className="fill-zinc-400 dark:fill-zinc-500"
                fontSize={10}
                textAnchor="end"
                x={paddingLeft - 4}
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
            className="fill-zinc-400 dark:fill-zinc-500"
            fontSize={9}
            key={i}
            textAnchor="middle"
            x={xScale(i)}
            y={height - paddingBottom + 14}
          >
            {label}
          </text>
        ))}

        {/* Ideal burndown line (gray dashed) */}
        <path d={idealPath} fill="none" stroke="#a1a1aa" strokeDasharray="4 3" strokeWidth={1.5} />

        {/* Remaining line (indigo) */}
        <path d={remainingPath} fill="none" stroke="#6366f1" strokeWidth={2} />

        {/* Legend */}
        <g transform={`translate(${paddingLeft + 8}, ${paddingTop + 8})`}>
          <line
            stroke="#a1a1aa"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            x1={0}
            x2={16}
            y1={5}
            y2={5}
          />
          <text className="fill-zinc-500 dark:fill-zinc-400" fontSize={9} x={20} y={9}>
            {t('cycles.chart.ideal')}
          </text>
          <line stroke="#6366f1" strokeWidth={2} x1={50} x2={66} y1={5} y2={5} />
          <text className="fill-zinc-500 dark:fill-zinc-400" fontSize={9} x={70} y={9}>
            {t('cycles.chart.remaining')}
          </text>
        </g>
      </svg>
    </div>
  );
}
