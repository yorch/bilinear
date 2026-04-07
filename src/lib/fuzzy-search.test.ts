import { describe, expect, it } from 'vitest';
import { fuzzyScore, fuzzySearch } from './fuzzy-search';

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

describe('fuzzySearch', () => {
  const items = [
    { id: '1', title: 'Fix authentication bug' },
    { id: '2', title: 'Implement dark mode' },
    { id: '3', title: 'Auth token refresh' },
    { id: '4', title: 'Broken login page' },
  ];

  it('returns all items with score 1 for empty query', () => {
    const results = fuzzySearch(items, '', i => i.title);
    expect(results).toHaveLength(4);
    expect(results.every(r => r.score === 1)).toBe(true);
  });

  it('filters items that do not match', () => {
    const results = fuzzySearch(items, 'auth', i => i.title);
    // 'auth' appears in items 1 and 3, not 2 and 4
    const ids = results.map(r => r.item.id);
    expect(ids).toContain('1');
    expect(ids).toContain('3');
    expect(ids).not.toContain('2');
  });

  it('returns results sorted by descending score', () => {
    const results = fuzzySearch(items, 'auth', i => i.title);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('returns empty array when nothing matches', () => {
    const results = fuzzySearch(items, 'xyzzy_not_found', i => i.title);
    expect(results).toHaveLength(0);
  });
});
