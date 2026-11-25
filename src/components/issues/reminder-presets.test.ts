import { describe, expect, it } from 'vitest';
import {
  getReminderPresets,
  parseReminderInput,
  reminderInputMin,
  remindLaterToday,
} from './reminder-presets';

const at = (iso: string) => new Date(iso);

describe('remindLaterToday', () => {
  it('is at least three hours out, rounded up to the hour, when still today', () => {
    expect(remindLaterToday(at('2026-11-24T09:20:00'))).toEqual(at('2026-11-24T13:00:00'));
  });

  it('never returns less than three hours, even on the hour', () => {
    expect(remindLaterToday(at('2026-11-24T09:00:00'))).toEqual(at('2026-11-24T12:00:00'));
    expect(remindLaterToday(at('2026-11-24T09:00:01'))).toEqual(at('2026-11-24T13:00:00'));
  });

  it('is null once it would spill into tomorrow', () => {
    expect(remindLaterToday(at('2026-11-24T21:30:00'))).toBeNull();
  });
});

describe('getReminderPresets', () => {
  it('drops "later today" late in the day and keeps tomorrow / next week', () => {
    const keys = getReminderPresets(at('2026-11-24T22:00:00')).map(p => p.key);
    expect(keys).toEqual(['tomorrow', 'nextWeek']);
  });

  it('offers all three during the day, all in the future', () => {
    const now = at('2026-11-24T10:00:00');
    const presets = getReminderPresets(now);
    expect(presets.map(p => p.key)).toEqual(['laterToday', 'tomorrow', 'nextWeek']);
    for (const p of presets) {
      expect(p.at.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('parseReminderInput', () => {
  const now = at('2026-11-24T10:00:00');
  it('parses a future local datetime', () => {
    expect(parseReminderInput('2026-11-25T08:30', now)).toEqual(at('2026-11-25T08:30:00'));
  });
  it('rejects empty, malformed, past and current values', () => {
    expect(parseReminderInput('', now)).toBeNull();
    expect(parseReminderInput('2026-11-25', now)).toBeNull();
    expect(parseReminderInput('2026-11-24T09:59', now)).toBeNull();
    expect(parseReminderInput('2026-11-24T10:00', now)).toBeNull();
  });
});

describe('reminderInputMin', () => {
  it('formats local time for the picker', () => {
    expect(reminderInputMin(at('2026-01-05T07:08:00'))).toBe('2026-01-05T07:08');
  });
});
