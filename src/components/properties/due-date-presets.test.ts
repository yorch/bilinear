import { describe, expect, it } from 'vitest';
import { getDueDatePresets } from './due-date-presets';

const byKey = (now: Date) => Object.fromEntries(getDueDatePresets(now).map(p => [p.key, p.date]));

describe('getDueDatePresets', () => {
  it('on a Wednesday: Friday this week, Monday next week', () => {
    // 2026-11-04 is a Wednesday
    expect(byKey(new Date(2026, 10, 4))).toEqual({
      endOfWeek: '2026-11-06',
      nextWeek: '2026-11-09',
      today: '2026-11-04',
      tomorrow: '2026-11-05',
    });
  });

  it('on a Friday end-of-week moves to the following Friday, never today', () => {
    const p = byKey(new Date(2026, 10, 6));
    expect(p.today).toBe('2026-11-06');
    expect(p.endOfWeek).toBe('2026-11-13');
  });

  it('on a Monday next week is seven days out, never today', () => {
    expect(byKey(new Date(2026, 10, 2)).nextWeek).toBe('2026-11-09');
  });

  it('on a Sunday Monday is tomorrow, so next week is dropped; end-of-week is Friday', () => {
    const p = byKey(new Date(2026, 10, 8));
    expect(p.tomorrow).toBe('2026-11-09');
    expect(p.nextWeek).toBeUndefined();
    expect(p.endOfWeek).toBe('2026-11-13');
  });

  it('on a Thursday Friday is tomorrow, so end-of-week is dropped', () => {
    const p = byKey(new Date(2026, 10, 5));
    expect(p.tomorrow).toBe('2026-11-06');
    expect(p.endOfWeek).toBeUndefined();
    expect(p.nextWeek).toBe('2026-11-09');
  });

  it('never returns two presets for the same date, on any weekday', () => {
    for (let d = 1; d <= 14; d++) {
      const dates = getDueDatePresets(new Date(2026, 10, d)).map(p => p.date);
      expect(new Set(dates).size).toBe(dates.length);
    }
  });

  it('rolls across a month boundary', () => {
    expect(byKey(new Date(2026, 9, 30)).tomorrow).toBe('2026-10-31');
    expect(byKey(new Date(2026, 9, 31)).tomorrow).toBe('2026-11-01');
  });
});
