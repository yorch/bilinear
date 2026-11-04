import { describe, expect, it } from 'vitest';
import { formatDateOnly, isValidProjectRange, toDateOnly } from './project-dates';

describe('toDateOnly', () => {
  it('strips the time part of an ISO timestamp', () => {
    expect(toDateOnly('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
  });
  it('passes a date-only value through', () => {
    expect(toDateOnly('2026-10-01')).toBe('2026-10-01');
  });
  it('returns null for empty or malformed input', () => {
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly('')).toBeNull();
    expect(toDateOnly('soon')).toBeNull();
  });
});

describe('formatDateOnly', () => {
  it('never prints the raw ISO string', () => {
    const out = formatDateOnly('2026-10-01T00:00:00.000Z', 'en-US');
    expect(out).toBe('Oct 1, 2026');
    expect(out).not.toContain('T00');
  });
  it('is stable regardless of the process timezone', () => {
    expect(formatDateOnly('2026-01-01T00:00:00.000Z', 'en-US', { day: 'numeric' })).toBe('1');
  });
  it('returns an empty string for missing input', () => {
    expect(formatDateOnly(undefined, 'en-US')).toBe('');
  });
});

describe('isValidProjectRange', () => {
  it('rejects a target before the start', () => {
    expect(isValidProjectRange('2026-12-01', '2026-11-01')).toBe(false);
  });
  it('accepts same-day and later targets', () => {
    expect(isValidProjectRange('2026-11-01', '2026-11-01')).toBe(true);
    expect(isValidProjectRange('2026-11-01', '2026-12-01T00:00:00.000Z')).toBe(true);
  });
  it('accepts a range with either end unset', () => {
    expect(isValidProjectRange('', '2026-11-01')).toBe(true);
    expect(isValidProjectRange('2026-11-01', undefined)).toBe(true);
  });
});
