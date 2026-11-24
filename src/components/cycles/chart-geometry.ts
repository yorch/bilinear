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

export const PLOT_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;

/** Plot width for a chart drawn `width` px wide. Defaults to the 600px design width. */
export const plotWidth = (width: number = CHART_WIDTH) => width - PADDING_LEFT - PADDING_RIGHT;
export const PLOT_WIDTH = plotWidth();

export interface ChartScales {
  /** Index -> x. A single point is centred rather than pinned to the left edge. */
  xScale: (i: number) => number;
  /** Value -> y, inverted so 0 sits on the axis. */
  yScale: (v: number) => number;
  /** Y-axis ticks: 0, midpoint, max — de-duplicated, so a max of 1 isn't `[0, 1, 1]`. */
  yTicks: number[];
}

/**
 * `width` is the rendered width in px. Charts size their viewBox to the
 * container instead of scaling a fixed 600x300 canvas, so axis text keeps its
 * real pixel size on a 390px screen instead of shrinking to ~5px.
 */
export function makeScales(
  pointCount: number,
  maxY: number,
  width: number = CHART_WIDTH,
): ChartScales {
  const pw = plotWidth(width);
  const xScale = (i: number) =>
    PADDING_LEFT + (pointCount > 1 ? (i / (pointCount - 1)) * pw : pw / 2);
  const yScale = (v: number) => PADDING_TOP + PLOT_HEIGHT - (v / maxY) * PLOT_HEIGHT;
  return {
    xScale,
    yScale,
    yTicks: Array.from(new Set([0, Math.round(maxY / 2), maxY])),
  };
}

/** Serialise plotted points into an SVG path, one decimal place per coordinate. */
export function toPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
}

/** Minimum horizontal room one x-axis label needs, in px. */
const LABEL_SLOT = 52;

/** Every `step`-th point such that labels fit `width` without touching. */
export function xAxisStep(pointCount: number, width: number = CHART_WIDTH): number {
  const slots = Math.max(2, Math.floor(plotWidth(width) / LABEL_SLOT));
  return Math.max(1, Math.ceil(pointCount / slots));
}

/**
 * Every `step`-th date plus the last. A stepped label that sits fewer than
 * `step` points from the last one is dropped, because the two would overprint
 * ("Nov 3 Nov 4"). `format` is passed in because it is locale-bound.
 */
export function xAxisLabels<T extends { date: string }>(
  data: T[],
  format: (date: string) => string,
  step = 3,
): Array<{ i: number; label: string }> {
  const last = data.length - 1;
  return data
    .map((d, i) => ({ i, label: format(d.date) }))
    .filter(({ i }) => i === last || (i % step === 0 && last - i >= step));
}

/**
 * Scope the ideal line burns down from: the first non-zero scope in the series.
 *
 * It used to be `data[0].scope`, which is 0 whenever the cycle's issues were
 * stamped into it after day one (planning on the cycle's first morning, or any
 * import) — so the "ideal" collapsed to a flat line along the axis and the
 * chart said nothing about pace. An empty cycle still yields 0.
 */
export function plannedScope(data: Array<{ scope: number }>): number {
  return data.find(d => d.scope > 0)?.scope ?? 0;
}

/**
 * Ideal remaining work on each of `count` evenly spaced days: linear from
 * `planned` on the first day to 0 on the last. A single day has nothing to
 * burn towards, so it reports `planned`.
 */
export function idealSeries(planned: number, count: number): number[] {
  if (count <= 1) {
    return [planned];
  }
  return Array.from({ length: count }, (_, i) => planned - (planned / (count - 1)) * i);
}

const DAY_MS = 86_400_000;
/** Safety cap so a corrupt `endsAt` cannot ask for thousands of axis points. */
const MAX_AXIS_DAYS = 120;

/**
 * The x axis for a cycle chart: the recorded days, then every remaining day up
 * to `endsAt`. The series stops at today but the ideal line has to reach zero
 * on the cycle's *last* day, not today.
 */
export function extendAxis<T extends { date: string }>(
  data: T[],
  endsAt?: string | null,
): Array<{ date: string }> {
  const axis: Array<{ date: string }> = data.map(d => ({ date: d.date }));
  if (!endsAt || data.length === 0) {
    return axis;
  }
  const lastRecorded = Date.parse(`${data[data.length - 1].date}T00:00:00Z`);
  const endDay = Date.parse(`${endsAt.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(lastRecorded) || Number.isNaN(endDay)) {
    return axis;
  }
  for (let t = lastRecorded + DAY_MS; t <= endDay && axis.length < MAX_AXIS_DAYS; t += DAY_MS) {
    axis.push({ date: new Date(t).toISOString().slice(0, 10) });
  }
  return axis;
}
