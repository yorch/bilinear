import { describe, expect, it } from 'vitest';
import { buildAxis, MAX_AXIS_POINTS, placeOnAxis } from './burnup-axis';

const series = (n: number, start = '2025-01-01') =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
  }));

describe('buildAxis', () => {
  it('fits the longest series plus the longest forecast', () => {
    expect(MAX_AXIS_POINTS).toBe(365 + 730 + 1);
    const points = series(365, '2025-11-24');
    const last = points[364].date;
    const finish = new Date(Date.parse(`${last}T00:00:00Z`) + 730 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const axis = buildAxis({ forecast: { projectedFinish: finish }, points, targetDate: null });
    expect(axis.at(-1)).toBe(finish); // the finish day is on the axis
    expect(placeOnAxis(finish, axis)?.clipped).toBeNull();
  });

  it('never grows past the cap, even for a target decades away', () => {
    const axis = buildAxis({
      forecast: { projectedFinish: null },
      points: series(10),
      targetDate: '2099-01-01',
    });
    expect(axis).toHaveLength(MAX_AXIS_POINTS);
  });

  it('is just the series when nothing lies beyond it', () => {
    expect(
      buildAxis({ forecast: { projectedFinish: null }, points: series(3), targetDate: null }),
    ).toHaveLength(3);
  });
});

describe('placeOnAxis', () => {
  const axis = series(10, '2026-06-01').map(p => p.date);
  it('places an on-axis date', () => {
    expect(placeOnAxis('2026-06-04', axis)).toEqual({ clipped: null, index: 3 });
  });
  it('pins a date before the first point to the left edge instead of dropping it', () => {
    expect(placeOnAxis('2026-01-01', axis)).toEqual({ clipped: 'before', index: 0 });
  });
  it('pins a date past the end to the right edge', () => {
    expect(placeOnAxis('2099-01-01', axis)).toEqual({ clipped: 'after', index: 9 });
  });
  it('returns null for no date', () => {
    expect(placeOnAxis(null, axis)).toBeNull();
  });
});
