/**
 * Project burn-up series + completion forecast. Pure: the server feeds it issue
 * timestamps, the tests feed it literals, nothing here touches a clock or a DB.
 *
 * Day bucketing is UTC, exactly as `CycleService.getBurndown` does it, so a
 * project chart and a cycle chart agree about which day an issue completed on.
 *
 * There is no per-issue project-membership history, so "moved in/out" is
 * derived from what we do have:
 *  - an issue enters scope on `addedToProjectAt` (falling back to `createdAt`
 *    for rows that predate the stamp, or were created in the project);
 *  - an issue that is later canceled leaves scope on `canceledAt`;
 *  - an issue moved OUT of the project (or trashed/archived) is simply absent
 *    from the input, so it disappears from the whole series. That rewrites
 *    history for that one issue — the honest alternative needs a history table.
 */

export interface BurnupIssue {
  addedToProjectAt: Date | null;
  canceledAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface BurnupPoint {
  completed: number;
  /** UTC day, YYYY-MM-DD. */
  date: string;
  scope: number;
}

export type ForecastStatus = 'complete' | 'insufficient' | 'projected';
export type ForecastReason = 'noCompletions' | 'noIssues' | 'tooShort' | 'tooFar';

export interface BurnupForecast {
  /** YYYY-MM-DD, only when `status === 'projected'` (or the completion day when complete). */
  projectedFinish: string | null;
  reason: ForecastReason | null;
  /** Issues still open at `today`. */
  remaining: number;
  status: ForecastStatus;
  /** Completed issues per day over the trailing window. */
  velocityPerDay: number;
  windowDays: number;
}

/** Longest series we emit; older history is folded into the first point. */
export const MAX_BURNUP_DAYS = 365;
/** Trailing window used for velocity. */
export const FORECAST_WINDOW_DAYS = 28;
/** A projection further out than this is noise, not a forecast. */
export const FORECAST_MAX_HORIZON_DAYS = 730;
/** Fewest days of history before a velocity means anything. */
export const FORECAST_MIN_HISTORY_DAYS = 7;

const DAY_MS = 86_400_000;

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dayIndex(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Daily cumulative scope + completed from the first scope event through `today`. */
export function buildBurnupSeries(
  issues: BurnupIssue[],
  today: Date,
  maxDays: number = MAX_BURNUP_DAYS,
): BurnupPoint[] {
  if (issues.length === 0) {
    return [];
  }
  const todayDay = utcDay(today);
  const scopeDelta = new Map<string, number>();
  const completedDelta = new Map<string, number>();
  const bump = (m: Map<string, number>, day: string, by: number) =>
    m.set(day, (m.get(day) ?? 0) + by);

  let first = todayDay;
  for (const issue of issues) {
    const entered = utcDay(issue.addedToProjectAt ?? issue.createdAt);
    // An event in the future (clock skew) is clamped to today so it still counts.
    const enterDay = entered > todayDay ? todayDay : entered;
    bump(scopeDelta, enterDay, 1);
    if (enterDay < first) {
      first = enterDay;
    }
    if (issue.completedAt) {
      // Completed before it joined the project: count it on the day it joined.
      const done = utcDay(issue.completedAt);
      bump(completedDelta, done < enterDay ? enterDay : done > todayDay ? todayDay : done, 1);
    } else if (issue.canceledAt) {
      const gone = utcDay(issue.canceledAt);
      bump(scopeDelta, gone < enterDay ? enterDay : gone > todayDay ? todayDay : gone, -1);
    }
  }

  const span = dayIndex(todayDay) - dayIndex(first);
  const startDay = span + 1 > maxDays ? addDays(todayDay, -(maxDays - 1)) : first;
  let scope = 0;
  let completed = 0;
  // Fold everything before the visible window into the opening balance.
  for (const [day, by] of scopeDelta) {
    if (day < startDay) {
      scope += by;
    }
  }
  for (const [day, by] of completedDelta) {
    if (day < startDay) {
      completed += by;
    }
  }

  const points: BurnupPoint[] = [];
  const n = dayIndex(todayDay) - dayIndex(startDay);
  for (let i = 0; i <= n; i++) {
    const day = addDays(startDay, i);
    scope += scopeDelta.get(day) ?? 0;
    completed += completedDelta.get(day) ?? 0;
    points.push({ completed, date: day, scope });
  }
  return points;
}

/**
 * Linear projection: remaining work / trailing-window velocity. Deliberately
 * naive — it is a "does the current pace reach the date" signal, not a model.
 */
export function forecastCompletion(
  points: BurnupPoint[],
  windowDays: number = FORECAST_WINDOW_DAYS,
): BurnupForecast {
  const base = { projectedFinish: null, reason: null, velocityPerDay: 0, windowDays };
  const last = points[points.length - 1];
  if (!last || last.scope === 0) {
    return { ...base, reason: 'noIssues', remaining: 0, status: 'insufficient' };
  }
  const remaining = Math.max(0, last.scope - last.completed);
  if (remaining === 0) {
    return { ...base, projectedFinish: last.date, remaining: 0, status: 'complete' };
  }
  // Need real history: a project created yesterday has no velocity yet.
  if (points.length < FORECAST_MIN_HISTORY_DAYS) {
    return { ...base, reason: 'tooShort', remaining, status: 'insufficient' };
  }
  const back = Math.min(windowDays, points.length - 1);
  const anchor = points[points.length - 1 - back];
  const done = last.completed - anchor.completed;
  if (done <= 0) {
    return { ...base, reason: 'noCompletions', remaining, status: 'insufficient' };
  }
  const velocityPerDay = done / back;
  const daysNeeded = Math.ceil(remaining / velocityPerDay);
  if (daysNeeded > FORECAST_MAX_HORIZON_DAYS) {
    return { ...base, reason: 'tooFar', remaining, status: 'insufficient', velocityPerDay };
  }
  return {
    projectedFinish: addDays(last.date, daysNeeded),
    reason: null,
    remaining,
    status: 'projected',
    velocityPerDay,
    windowDays,
  };
}

/** Whole days `projected` falls after `target` (negative = ahead of target). */
export function daysBetween(target: string, projected: string): number {
  return dayIndex(projected) - dayIndex(target);
}
