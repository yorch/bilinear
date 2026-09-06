import { describe, expect, it } from 'vitest';
import { toDateOnly } from './date-only';

describe('toDateOnly', () => {
  it('returns the UTC calendar day, ignoring the time of day', () => {
    expect(toDateOnly(new Date('2026-04-16T23:59:59.999Z'))).toBe('2026-04-16');
    expect(toDateOnly(new Date('2026-04-16T00:00:00.000Z'))).toBe('2026-04-16');
  });
});
