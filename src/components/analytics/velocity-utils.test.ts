import { describe, expect, it } from 'vitest';
import { barPercent, maxCompletedCount } from './velocity-utils';

describe('maxCompletedCount', () => {
  it('is 0 when no team has completed anything, so the chart can be suppressed', () => {
    expect(maxCompletedCount([{ completedCount: 0 }, { completedCount: 0 }])).toBe(0);
    expect(maxCompletedCount([])).toBe(0);
  });

  it('returns the largest completed count', () => {
    expect(maxCompletedCount([{ completedCount: 3 }, { completedCount: 9 }])).toBe(9);
  });
});

describe('barPercent', () => {
  it('scales against the max and never divides by zero', () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(0, 0)).toBe(0);
  });
});
