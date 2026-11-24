import { FORECAST_MAX_HORIZON_DAYS, MAX_BURNUP_DAYS } from '@/lib/project-burnup';

const DAY_MS = 86_400_000;

/**
 * The axis never grows past the longest series plus the longest forecast the
 * server will emit (+1 for the day itself). A fixed 800 used to sit BELOW
 * 365 + 730, so a long forecast silently lost its finish point and line.
 */
export const MAX_AXIS_POINTS = MAX_BURNUP_DAYS + FORECAST_MAX_HORIZON_DAYS + 1;

export interface AxisInput {
  forecast: { projectedFinish: string | null };
  points: Array<{ date: string }>;
  targetDate: string | null;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Series days, then every day up to the later of the projected finish and the target. */
export function buildAxis(data: AxisInput): string[] {
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

export interface AxisPlacement {
  /** `before`/`after`: the date is off the axis and `index` is the nearest edge. */
  clipped: 'after' | 'before' | null;
  index: number;
}

/** Where `day` sits on `axis`; a date off either end is pinned to that edge, never dropped. */
export function placeOnAxis(day: string | null, axis: string[]): AxisPlacement | null {
  if (!day || axis.length === 0) {
    return null;
  }
  if (day < axis[0]) {
    return { clipped: 'before', index: 0 };
  }
  if (day > axis[axis.length - 1]) {
    return { clipped: 'after', index: axis.length - 1 };
  }
  const index = axis.indexOf(day);
  return index < 0 ? null : { clipped: null, index };
}
