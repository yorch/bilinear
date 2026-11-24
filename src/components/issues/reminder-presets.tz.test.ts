/**
 * The presets are local wall-clock arithmetic, so they are checked under real
 * timezones (including a UTC+14 one and a DST zone) by switching `process.env.TZ`,
 * which Node re-reads for every subsequent `Date` operation.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getReminderPresets,
  remindLaterToday,
  remindNextWeek,
  remindTomorrow,
  resolveReminderInput,
} from './reminder-presets';

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

const ZONES = ['America/New_York', 'Pacific/Kiritimati', 'UTC'] as const;
// Local wall-clock constructor: month is 1-based here for readability.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const parts = (d: Date) => [
  d.getFullYear(),
  d.getMonth() + 1,
  d.getDate(),
  d.getHours(),
  d.getMinutes(),
];

describe.each(ZONES)('reminder presets in %s', zone => {
  beforeEach(() => {
    process.env.TZ = zone;
  });

  it('on a Sunday, Tomorrow (Monday 09:00) and Next week are different instants', () => {
    const sunday = local(2026, 11, 22, 15, 0); // Sunday
    expect(sunday.getDay()).toBe(0);
    const tomorrow = remindTomorrow(sunday);
    const nextWeek = remindNextWeek(sunday);
    expect(parts(tomorrow)).toEqual([2026, 11, 23, 9, 0]);
    expect(parts(nextWeek)).toEqual([2026, 11, 30, 9, 0]);
    expect(nextWeek.getTime()).toBeGreaterThan(tomorrow.getTime());
  });

  it('Next week is the next Monday strictly after Tomorrow, on every weekday', () => {
    for (let day = 22; day <= 28; day++) {
      const now = local(2026, 11, day, 11, 0);
      const tomorrow = remindTomorrow(now);
      const nextWeek = remindNextWeek(now);
      expect(nextWeek.getDay()).toBe(1);
      expect(nextWeek.getHours()).toBe(9);
      expect(nextWeek.getTime()).toBeGreaterThan(tomorrow.getTime());
      expect(nextWeek.getTime() - now.getTime()).toBeLessThanOrEqual(8 * 86_400_000);
    }
  });

  it('Saturday: tomorrow is Sunday 09:00, next week is the Monday after', () => {
    const saturday = local(2026, 11, 28, 10, 0);
    expect(parts(remindTomorrow(saturday))).toEqual([2026, 11, 29, 9, 0]);
    expect(parts(remindNextWeek(saturday))).toEqual([2026, 11, 30, 9, 0]);
  });

  it('Later today is +3h rounded up to the hour, capped at 18:00', () => {
    expect(parts(remindLaterToday(local(2026, 11, 24, 10, 20)) as Date)).toEqual([
      2026, 11, 24, 14, 0,
    ]);
    expect(parts(remindLaterToday(local(2026, 11, 24, 15, 10)) as Date)).toEqual([
      2026, 11, 24, 18, 0,
    ]);
    expect(parts(remindLaterToday(local(2026, 11, 24, 17, 30)) as Date)).toEqual([
      2026, 11, 24, 18, 0,
    ]);
  });

  it('Later today is hidden once 18:00 has passed (and never spills into tomorrow)', () => {
    expect(remindLaterToday(local(2026, 11, 24, 18, 0))).toBeNull();
    expect(remindLaterToday(local(2026, 11, 24, 21, 30))).toBeNull();
    expect(remindLaterToday(local(2026, 11, 24, 23, 50))).toBeNull();
    const keys = getReminderPresets(local(2026, 11, 24, 22, 0)).map(p => p.key);
    expect(keys).toEqual(['tomorrow', 'nextWeek']);
  });

  it('at 00:10 Later today is this morning at 09:00, not 04:00', () => {
    expect(parts(remindLaterToday(local(2026, 11, 24, 0, 10)) as Date)).toEqual([
      2026, 11, 24, 9, 0,
    ]);
    expect(parts(remindLaterToday(local(2026, 11, 24, 5, 59)) as Date)).toEqual([
      2026, 11, 24, 9, 0,
    ]);
    expect(parts(remindLaterToday(local(2026, 11, 24, 7, 0)) as Date)).toEqual([
      2026, 11, 24, 10, 0,
    ]);
  });

  it('every preset is in the future and presets are strictly increasing', () => {
    for (const hour of [0, 3, 8, 12, 17, 18, 23]) {
      const now = local(2026, 11, 24, hour, 5);
      const at = getReminderPresets(now).map(p => p.at.getTime());
      for (const t of at) {
        expect(t).toBeGreaterThan(now.getTime());
      }
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(new Set(at).size).toBe(at.length);
    }
  });
});

describe('DST (America/New_York)', () => {
  beforeEach(() => {
    process.env.TZ = 'America/New_York';
  });

  it('Tomorrow keeps 09:00 across the spring-forward and fall-back nights', () => {
    expect(parts(remindTomorrow(local(2026, 3, 7, 20, 0)))).toEqual([2026, 3, 8, 9, 0]);
    expect(parts(remindTomorrow(local(2026, 10, 31, 20, 0)))).toEqual([2026, 11, 1, 9, 0]);
  });

  it('flags a custom time inside the spring-forward gap as shifted, and reports what it became', () => {
    const now = local(2026, 3, 1, 10, 0);
    const r = resolveReminderInput('2026-03-08T02:30', now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.shifted).toBe(true);
      expect(parts(r.at)).toEqual([2026, 3, 8, 3, 30]);
    }
  });

  it('does not flag an ordinary time as shifted', () => {
    const r = resolveReminderInput('2026-03-08T03:30', local(2026, 3, 1, 10, 0));
    expect(r.ok && r.shifted).toBe(false);
  });
});

describe('resolveReminderInput bounds', () => {
  beforeEach(() => {
    process.env.TZ = 'UTC';
  });
  const now = new Date('2026-11-24T10:00:00Z');
  it('classifies invalid, past and beyond-one-year values', () => {
    expect(resolveReminderInput('', now)).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveReminderInput('2026-11-24T10:00', now)).toEqual({ ok: false, reason: 'past' });
    expect(resolveReminderInput('2027-11-25T10:01', now)).toEqual({ ok: false, reason: 'tooFar' });
    expect(resolveReminderInput('2027-11-24T10:00', now).ok).toBe(true);
  });
});
