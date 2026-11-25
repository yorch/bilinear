import { describe, expect, it } from 'vitest';
import {
  type BurnupIssue,
  type BurnupPoint,
  buildBurnupSeries,
  FORECAST_MAX_HORIZON_DAYS,
  FORECAST_WINDOW_DAYS,
  forecastCompletion,
  MAX_BURNUP_DAYS,
} from './project-burnup';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const issue = (over: Partial<BurnupIssue> & { createdAt: Date }): BurnupIssue => ({
  addedToProjectAt: null,
  canceledAt: null,
  completedAt: null,
  ...over,
});

describe('buildBurnupSeries', () => {
  it('returns no points for an empty project', () => {
    expect(buildBurnupSeries([], d('2026-06-10'))).toEqual([]);
  });

  it('runs daily from the first scope event to today', () => {
    const s = buildBurnupSeries([issue({ createdAt: d('2026-06-08') })], d('2026-06-10'));
    expect(s.map(p => p.date)).toEqual(['2026-06-08', '2026-06-09', '2026-06-10']);
    expect(s.every(p => p.scope === 1 && p.completed === 0)).toBe(true);
  });

  it('steps scope when an issue is added later (addedToProjectAt beats createdAt)', () => {
    const s = buildBurnupSeries(
      [
        issue({ createdAt: d('2026-06-01') }),
        issue({ addedToProjectAt: d('2026-06-04'), createdAt: d('2026-05-01') }),
      ],
      d('2026-06-05'),
    );
    const byDay = Object.fromEntries(s.map(p => [p.date, p.scope]));
    expect(byDay['2026-05-01']).toBeUndefined(); // series starts at first scope event
    expect(byDay['2026-06-03']).toBe(1);
    expect(byDay['2026-06-04']).toBe(2);
  });

  it('counts completions on their UTC day and keeps scope', () => {
    const s = buildBurnupSeries(
      [
        issue({ completedAt: d('2026-06-03'), createdAt: d('2026-06-01') }),
        issue({ createdAt: d('2026-06-01') }),
      ],
      d('2026-06-04'),
    );
    expect(s.map(p => p.completed)).toEqual([0, 0, 1, 1]);
    expect(s.map(p => p.scope)).toEqual([2, 2, 2, 2]);
  });

  it('counts an issue completed before it joined on the day it joined', () => {
    const s = buildBurnupSeries(
      [
        issue({
          addedToProjectAt: d('2026-06-05'),
          completedAt: d('2026-06-01'),
          createdAt: d('2026-06-01'),
        }),
      ],
      d('2026-06-05'),
    );
    expect(s).toEqual([{ completed: 1, date: '2026-06-05', scope: 1 }]);
  });

  it('drops canceled issues from scope on the cancel day, never counting them done', () => {
    const s = buildBurnupSeries(
      [
        issue({ canceledAt: d('2026-06-03'), createdAt: d('2026-06-01') }),
        issue({ createdAt: d('2026-06-01') }),
      ],
      d('2026-06-04'),
    );
    expect(s.map(p => p.scope)).toEqual([2, 2, 1, 1]);
    expect(s.every(p => p.completed === 0)).toBe(true);
  });

  it('an issue moved out of the project is simply absent (no trace)', () => {
    const both = buildBurnupSeries(
      [issue({ createdAt: d('2026-06-01') }), issue({ createdAt: d('2026-06-01') })],
      d('2026-06-02'),
    );
    const one = buildBurnupSeries([issue({ createdAt: d('2026-06-01') })], d('2026-06-02'));
    expect(both[1].scope).toBe(2);
    expect(one[1].scope).toBe(1);
  });

  it('clamps an issue that "entered" in the future to today so it still counts', () => {
    const s = buildBurnupSeries([issue({ createdAt: d('2026-06-20') })], d('2026-06-10'));
    expect(s.at(-1)).toEqual({ completed: 0, date: '2026-06-10', scope: 1 });
  });

  it('clamps a future completion to today', () => {
    const s = buildBurnupSeries(
      [issue({ completedAt: d('2026-06-20'), createdAt: d('2026-06-08') })],
      d('2026-06-10'),
    );
    expect(s.at(-1)).toMatchObject({ completed: 1, date: '2026-06-10' });
  });

  it('clamps a future cancellation to today', () => {
    const s = buildBurnupSeries(
      [issue({ canceledAt: d('2026-06-20'), createdAt: d('2026-06-08') })],
      d('2026-06-10'),
    );
    expect(s.map(p => p.scope)).toEqual([1, 1, 0]);
  });

  it('a cancellation dated before the issue joined nets out on the join day', () => {
    const s = buildBurnupSeries(
      [
        issue({ createdAt: d('2026-06-01') }),
        issue({
          addedToProjectAt: d('2026-06-05'),
          canceledAt: d('2026-06-03'),
          createdAt: d('2026-06-01'),
        }),
      ],
      d('2026-06-05'),
    );
    expect(Object.fromEntries(s.map(p => [p.date, p.scope]))).toMatchObject({
      '2026-06-03': 1,
      '2026-06-05': 1,
    });
  });

  it('caps the window and folds older history into the opening balance', () => {
    const s = buildBurnupSeries(
      [
        issue({ completedAt: d('2024-01-02'), createdAt: d('2024-01-01') }),
        issue({ createdAt: d('2024-01-01') }),
      ],
      d('2026-06-01'),
    );
    expect(s).toHaveLength(MAX_BURNUP_DAYS);
    expect(s[0]).toMatchObject({ completed: 1, scope: 2 });
  });
});

function ramp(days: number, perDay: number, scope: number) {
  return Array.from({ length: days }, (_, i) => ({
    completed: Math.min(scope, i * perDay),
    date: new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
    scope,
  }));
}

describe('forecastCompletion', () => {
  it('has no data for an empty series', () => {
    expect(forecastCompletion([])).toMatchObject({ reason: 'noIssues', status: 'insufficient' });
  });

  it('reports complete when nothing remains', () => {
    const f = forecastCompletion([{ completed: 3, date: '2026-06-01', scope: 3 }]);
    expect(f).toMatchObject({ projectedFinish: '2026-06-01', remaining: 0, status: 'complete' });
  });

  it('needs at least a week of history', () => {
    expect(forecastCompletion(ramp(3, 1, 20))).toMatchObject({
      reason: 'tooShort',
      status: 'insufficient',
    });
  });

  it('is insufficient with zero completions in the window', () => {
    expect(forecastCompletion(ramp(20, 0, 10))).toMatchObject({
      reason: 'noCompletions',
      status: 'insufficient',
    });
  });

  it('projects remaining / trailing velocity', () => {
    // 10 days at 1/day, scope 30: completed 9 on last day, 21 left, velocity 1/day -> +21d
    const pts = ramp(10, 1, 30);
    const f = forecastCompletion(pts);
    expect(f.status).toBe('projected');
    expect(f.velocityPerDay).toBe(1);
    expect(f.remaining).toBe(21);
    expect(f.projectedFinish).toBe('2026-07-01'); // 2026-06-10 + 21d
  });

  it('uses only the trailing window, not lifetime average', () => {
    // 30 idle days then 28 days at 2/day: window velocity 2, lifetime ~0.97
    const idle = ramp(30, 0, 200);
    const fast = Array.from({ length: 28 }, (_, i) => ({
      completed: (i + 1) * 2,
      date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
      scope: 200,
    }));
    const f = forecastCompletion([...idle, ...fast]);
    expect(f.velocityPerDay).toBe(2);
  });

  it('refuses absurd horizons', () => {
    const pts = ramp(10, 0, 100000).map((p, i) => ({ ...p, completed: i === 9 ? 1 : 0 }));
    expect(forecastCompletion(pts)).toMatchObject({ reason: 'tooFar', status: 'insufficient' });
  });

  it('the trailing window is exactly FORECAST_WINDOW_DAYS wide', () => {
    // 32 idle days, 14 days at 3/day, 14 days at 1/day. A 28-day window sees
    // (14*3 + 14*1)/28 = 2/day; a 14-day window would see 1/day.
    const pts: BurnupPoint[] = [];
    let completed = 0;
    for (let i = 0; i < 60; i++) {
      if (i >= 32) {
        completed += i < 46 ? 3 : 1;
      }
      pts.push({
        completed,
        date: new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10),
        scope: 500,
      });
    }
    const f = forecastCompletion(pts);
    expect(FORECAST_WINDOW_DAYS).toBe(28);
    expect(f.windowDays).toBe(28);
    expect(f.velocityPerDay).toBe(2);
  });

  it('rounds the days needed UP', () => {
    // velocity 3/day, 10 left -> 3.33 days -> finishes on day 4, not day 3
    const pts = ramp(10, 3, 37); // completed 27 on 2026-06-10
    const f = forecastCompletion(pts);
    expect(f.remaining).toBe(10);
    expect(f.projectedFinish).toBe('2026-06-14');
  });

  it('the horizon is exactly FORECAST_MAX_HORIZON_DAYS: at it projects, one past it refuses', () => {
    expect(FORECAST_MAX_HORIZON_DAYS).toBe(730);
    // velocity 1/day (9 done over 9 days); remaining = scope - 9
    expect(forecastCompletion(ramp(10, 1, 9 + 730)).status).toBe('projected');
    expect(forecastCompletion(ramp(10, 1, 9 + 731))).toMatchObject({
      reason: 'tooFar',
      status: 'insufficient',
    });
  });

  it('a single completion in the window is enough for a forecast', () => {
    const pts = ramp(10, 0, 5).map((p, i) => ({ ...p, completed: i === 9 ? 1 : 0 }));
    expect(forecastCompletion(pts)).toMatchObject({ status: 'projected' });
  });
});
