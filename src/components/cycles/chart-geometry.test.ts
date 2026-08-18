import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  makeScales,
  PADDING_BOTTOM,
  PADDING_LEFT,
  PADDING_RIGHT,
  PADDING_TOP,
  PLOT_HEIGHT,
  PLOT_WIDTH,
  toPath,
  xAxisLabels,
} from './chart-geometry';

/**
 * The burndown and burnup charts render raw SVG with no test of their own, so
 * this pins the geometry they now share. The numbers below are the literals both
 * charts carried inline before the extraction — if one of them changes, the two
 * charts move together and this test is the record of what they moved from.
 */
describe('chart geometry constants', () => {
  it('keeps the dimensions both charts were drawn with', () => {
    expect([CHART_WIDTH, CHART_HEIGHT]).toEqual([600, 300]);
    expect([PADDING_LEFT, PADDING_RIGHT, PADDING_TOP, PADDING_BOTTOM]).toEqual([36, 12, 12, 32]);
  });

  it('derives the plot box from the frame minus its padding', () => {
    expect(PLOT_WIDTH).toBe(CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT);
    expect(PLOT_HEIGHT).toBe(CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM);
    expect([PLOT_WIDTH, PLOT_HEIGHT]).toEqual([552, 256]);
  });
});

describe('makeScales', () => {
  it('spreads points across the plot width, first on the left edge and last on the right', () => {
    const { xScale } = makeScales(5, 10);

    expect(xScale(0)).toBe(PADDING_LEFT);
    expect(xScale(4)).toBe(PADDING_LEFT + PLOT_WIDTH);
    expect(xScale(2)).toBe(PADDING_LEFT + PLOT_WIDTH / 2);
  });

  it('centres a lone point instead of pinning it to the left edge', () => {
    const { xScale } = makeScales(1, 10);

    expect(xScale(0)).toBe(PADDING_LEFT + PLOT_WIDTH / 2);
  });

  it('inverts the y axis so zero sits on the baseline and max at the top', () => {
    const { yScale } = makeScales(5, 20);

    expect(yScale(0)).toBe(PADDING_TOP + PLOT_HEIGHT);
    expect(yScale(20)).toBe(PADDING_TOP);
    expect(yScale(10)).toBe(PADDING_TOP + PLOT_HEIGHT / 2);
  });

  it('ticks at zero, the midpoint and the max', () => {
    expect(makeScales(3, 20).yTicks).toEqual([0, 10, 20]);
    // An odd max rounds rather than emitting a fractional tick label.
    expect(makeScales(3, 7).yTicks).toEqual([0, 4, 7]);
  });
});

describe('toPath', () => {
  it('moves to the first point and lines to the rest, at one decimal place', () => {
    expect(
      toPath([
        { x: 1.24, y: 2.25 },
        { x: 3, y: 4 },
      ]),
    ).toBe('M 1.2 2.3 L 3.0 4.0');
  });

  it('serialises an empty series to an empty path rather than throwing', () => {
    expect(toPath([])).toBe('');
  });
});

describe('xAxisLabels', () => {
  const data = Array.from({ length: 8 }, (_, i) => ({ date: `day-${i}` }));

  it('labels every third point plus the last, so labels cannot collide', () => {
    expect(xAxisLabels(data, d => d).map(l => l.i)).toEqual([0, 3, 6, 7]);
  });

  it('carries the original index through for positioning', () => {
    expect(xAxisLabels(data, d => d.toUpperCase())).toContainEqual({ i: 3, label: 'DAY-3' });
  });

  it('does not emit the last point twice when it is already a multiple of three', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ date: `day-${i}` }));

    expect(xAxisLabels(seven, d => d).map(l => l.i)).toEqual([0, 3, 6]);
  });
});
