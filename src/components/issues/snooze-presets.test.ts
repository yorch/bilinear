import { describe, expect, it } from 'vitest';
import {
  getSnoozePresets,
  isIssueSnoozed,
  SNOOZE_WAKE_HOUR,
  snoozeUntilDate,
  snoozeUntilNextWeek,
  snoozeUntilTomorrow,
} from './snooze-presets';

// Wednesday 2026-09-02 15:30 local.
const WED = new Date(2026, 8, 2, 15, 30);

describe('snooze presets', () => {
  it('tomorrow lands on the next calendar day at the wake hour', () => {
    const d = snoozeUntilTomorrow(WED);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 8, 3]);
    expect([d.getHours(), d.getMinutes()]).toEqual([SNOOZE_WAKE_HOUR, 0]);
  });

  it('tomorrow rolls over month boundaries', () => {
    const d = snoozeUntilTomorrow(new Date(2026, 8, 30, 10));
    expect([d.getMonth(), d.getDate()]).toEqual([9, 1]);
  });

  it('next week is the coming Monday from mid-week', () => {
    const d = snoozeUntilNextWeek(WED);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(7);
    expect(d.getHours()).toBe(SNOOZE_WAKE_HOUR);
  });

  it('next week from a Monday is seven days out, never today', () => {
    const monday = new Date(2026, 8, 7, 8);
    const d = snoozeUntilNextWeek(monday);
    expect(d.getDay()).toBe(1);
    expect(d.getDate()).toBe(14);
  });

  it('next week from a Sunday is the very next day', () => {
    const sunday = new Date(2026, 8, 6, 8);
    expect(snoozeUntilNextWeek(sunday).getDate()).toBe(7);
  });

  it('exposes the presets in menu order', () => {
    expect(getSnoozePresets(WED).map(p => p.key)).toEqual(['tomorrow', 'nextWeek']);
  });

  it('parses a custom date into the wake instant and rejects the past', () => {
    const d = snoozeUntilDate('2026-09-10', WED);
    expect(d).not.toBeNull();
    expect([d?.getDate(), d?.getHours()]).toEqual([10, SNOOZE_WAKE_HOUR]);
    expect(snoozeUntilDate('2026-09-01', WED)).toBeNull();
    expect(snoozeUntilDate('', WED)).toBeNull();
    expect(snoozeUntilDate('not-a-date', WED)).toBeNull();
  });

  it('treats only a future snoozedUntilAt as snoozed', () => {
    expect(isIssueSnoozed(null, WED)).toBe(false);
    expect(isIssueSnoozed(new Date(2026, 8, 1).toISOString(), WED)).toBe(false);
    expect(isIssueSnoozed(new Date(2026, 8, 9).toISOString(), WED)).toBe(true);
    expect(isIssueSnoozed('garbage', WED)).toBe(false);
  });
});
