import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useReactionCounts } from './use-reaction-counts';

describe('useReactionCounts', () => {
  it('tallies each emoji', () => {
    const { result } = renderHook(() =>
      useReactionCounts(
        [
          { emoji: '👍', userId: 'u1' },
          { emoji: '👍', userId: 'u2' },
          { emoji: '🎉', userId: 'u2' },
        ],
        'u3',
      ),
    );
    expect(result.current['👍'].count).toBe(2);
    expect(result.current['🎉'].count).toBe(1);
  });

  // `reacted` is what turns the pill on and makes a second click a removal, so
  // it must key off the viewer and nobody else.
  it('flags only the emoji the viewer reacted with', () => {
    const { result } = renderHook(() =>
      useReactionCounts(
        [
          { emoji: '👍', userId: 'me' },
          { emoji: '🎉', userId: 'someone-else' },
        ],
        'me',
      ),
    );
    expect(result.current['👍'].reacted).toBe(true);
    expect(result.current['🎉'].reacted).toBe(false);
  });

  it('treats an unauthenticated viewer as having reacted to nothing', () => {
    const { result } = renderHook(() =>
      useReactionCounts([{ emoji: '👍', userId: 'u1' }], undefined),
    );
    expect(result.current['👍'].reacted).toBe(false);
  });

  it('returns an empty map for no reactions', () => {
    const { result } = renderHook(() => useReactionCounts([], 'me'));
    expect(result.current).toEqual({});
  });

  // useRetryableFetch hands back a fresh array per fetch, so the memo has to
  // recompute when the identity changes or the bar renders stale counts.
  it('recomputes when the reaction list changes', () => {
    const { result, rerender } = renderHook(({ reactions }) => useReactionCounts(reactions, 'me'), {
      initialProps: { reactions: [{ emoji: '👍', userId: 'u1' }] },
    });
    expect(result.current['👍'].count).toBe(1);

    rerender({
      reactions: [
        { emoji: '👍', userId: 'u1' },
        { emoji: '👍', userId: 'me' },
      ],
    });
    expect(result.current['👍'].count).toBe(2);
    expect(result.current['👍'].reacted).toBe(true);
  });
});
