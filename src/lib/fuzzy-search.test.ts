import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy-search';

describe('fuzzyScore', () => {
  it('returns 1 for empty query', () => {
    expect(fuzzyScore('anything', '')).toBe(1);
  });

  it('returns 1 for exact match', () => {
    expect(fuzzyScore('bug fix', 'bug fix')).toBe(1);
  });

  it('returns a high score for prefix match', () => {
    const score = fuzzyScore('broken login page', 'broken');
    expect(score).toBeGreaterThan(0.9);
  });

  it('returns 0 when query characters are not a subsequence of target', () => {
    expect(fuzzyScore('abc', 'xyz')).toBe(0);
  });

  it('returns > 0 for a valid subsequence', () => {
    expect(fuzzyScore('broken authentication', 'auth')).toBeGreaterThan(0);
  });

  it('consecutive matches score higher than scattered matches', () => {
    const consecutive = fuzzyScore('fix bug', 'fix');
    const scattered = fuzzyScore('f-i-x bug', 'fix');
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('scores are in [0, 1] range', () => {
    for (const [target, query] of [
      ['hello world', 'world'],
      ['ENG-123', 'ENG'],
      ['implement authentication', 'auth'],
    ]) {
      const s = fuzzyScore(target, query);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('Bug Fix', 'bug')).toBeGreaterThan(0);
    expect(fuzzyScore('BUG FIX', 'bug')).toBeGreaterThan(0);
  });
});
