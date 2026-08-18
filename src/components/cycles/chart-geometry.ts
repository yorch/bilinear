/**
 * Shared SVG geometry for the cycle burndown and burnup charts.
 *
 * The two charts are deliberately NOT one component: they plot different
 * series, over different y-domains, with different ideal-line formulas and
 * different legends. Collapsing them would take a config object with a switch
 * per difference — the shape that makes a shared component harder to read than
 * the duplication it replaces.
 *
 * What they genuinely do share is the frame: identical dimensions, padding,
 * scales, path serialisation, tick positions and x-label thinning. Those are
 * pure functions of the data, and they have to change together — a padding or
 * height change that lands in only one chart is a bug. That is what lives here.
 */

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 300;
export const PADDING_LEFT = 36;
export const PADDING_RIGHT = 12;
export const PADDING_TOP = 12;
export const PADDING_BOTTOM = 32;

export const PLOT_WIDTH = CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT;
export const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

export interface ChartScales {
  /** Index -> x. A single point is centred rather than pinned to the left edge. */
  xScale: (i: number) => number;
  /** Value -> y, inverted so 0 sits on the axis. */
  yScale: (v: number) => number;
  /** The three y-axis ticks: 0, midpoint, max. */
  yTicks: number[];
}

export function makeScales(pointCount: number, maxY: number): ChartScales {
  const xScale = (i: number) =>
    PADDING_LEFT + (pointCount > 1 ? (i / (pointCount - 1)) * PLOT_WIDTH : PLOT_WIDTH / 2);
  const yScale = (v: number) => PADDING_TOP + PLOT_HEIGHT - (v / maxY) * PLOT_HEIGHT;
  return { xScale, yScale, yTicks: [0, Math.round(maxY / 2), maxY] };
}

/** Serialise plotted points into an SVG path, one decimal place per coordinate. */
export function toPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/**
 * Every third date plus the last, so labels never collide on a long cycle.
 * `format` is passed in because it is locale-bound and comes from a hook.
 */
export function xAxisLabels<T extends { date: string }>(
  data: T[],
  format: (date: string) => string,
): Array<{ i: number; label: string }> {
  return data
    .map((d, i) => ({ i, label: format(d.date) }))
    .filter((_, i) => i % 3 === 0 || i === data.length - 1);
}
