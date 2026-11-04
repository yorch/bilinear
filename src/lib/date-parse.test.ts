import { describe, expect, it } from 'vitest';
import { parseDate } from './date-parse';

describe('parseDate', () => {
  it('parses a date-only string as a local date', () => {
    expect(parseDate('2026-10-23')).toEqual(new Date(2026, 9, 23));
  });

  it('parses an ISO timestamp to the same calendar day', () => {
    expect(parseDate('2026-10-23T00:00:00.000Z')).toEqual(new Date(2026, 9, 23));
    expect(parseDate('2026-11-20T23:59:59.000Z')).toEqual(new Date(2026, 10, 20));
  });

  it('returns null for empty or invalid input', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
    expect(parseDate('2026-02-31')).toBeNull();
  });
});
