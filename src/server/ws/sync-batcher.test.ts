import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncBroadcastBatcher } from './sync-batcher';

describe('SyncBroadcastBatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces actions for one org into a single flush after the window', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new SyncBroadcastBatcher<number>(flush, 50);

    batcher.add('org-1', 1);
    batcher.add('org-1', 2);
    batcher.add('org-1', 3);
    expect(flush).not.toHaveBeenCalled(); // still within the window

    vi.advanceTimersByTime(50);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('org-1', [1, 2, 3]);
  });

  it('flushes each org independently', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new SyncBroadcastBatcher<string>(flush, 50);

    batcher.add('org-1', 'a');
    batcher.add('org-2', 'b');
    vi.advanceTimersByTime(50);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledWith('org-1', ['a']);
    expect(flush).toHaveBeenCalledWith('org-2', ['b']);
  });

  it('starts a fresh window after a flush', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new SyncBroadcastBatcher<number>(flush, 50);

    batcher.add('org-1', 1);
    vi.advanceTimersByTime(50);
    batcher.add('org-1', 2);
    vi.advanceTimersByTime(50);

    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenNthCalledWith(1, 'org-1', [1]);
    expect(flush).toHaveBeenNthCalledWith(2, 'org-1', [2]);
  });

  it('flushAll flushes pending buffers immediately (shutdown)', () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const batcher = new SyncBroadcastBatcher<number>(flush, 50);

    batcher.add('org-1', 1);
    batcher.add('org-2', 2);
    batcher.flushAll();

    expect(flush).toHaveBeenCalledTimes(2);
    // The pending timers are cleared, so no double-flush later.
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
