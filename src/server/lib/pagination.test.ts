import { describe, expect, it } from 'vitest';
import { clampLimit } from './pagination';

describe('clampLimit', () => {
  it('returns the default when limit is omitted (undefined)', () => {
    expect(clampLimit(undefined, 200, 50)).toBe(50);
  });

  it('returns the default when limit is null', () => {
    expect(clampLimit(null, 200, 50)).toBe(50);
  });

  it('returns the provided limit when it is under the max', () => {
    expect(clampLimit(10, 200, 50)).toBe(10);
  });

  it('clamps to max when the provided limit exceeds it', () => {
    expect(clampLimit(1000, 200, 50)).toBe(200);
  });

  it('returns exactly max when limit equals max', () => {
    expect(clampLimit(200, 200, 50)).toBe(200);
  });
});
