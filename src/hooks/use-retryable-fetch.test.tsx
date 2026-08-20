import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRetryableFetch } from './use-retryable-fetch';

/** A promise plus the handles to settle it from the test body. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

describe('useRetryableFetch', () => {
  it('seeds via onData with each successful result', async () => {
    const onData = vi.fn();
    const { result } = renderHook(() =>
      useRetryableFetch(() => Promise.resolve('first'), [], '', { onData }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(onData).toHaveBeenCalledWith('first');
    expect(onData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    expect(onData).toHaveBeenCalledTimes(2);
  });

  it('does not call onData when the fetch fails', async () => {
    const onData = vi.fn();
    const { result } = renderHook(() =>
      useRetryableFetch(() => Promise.reject(new Error('boom')), [], '', { onData }),
    );

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(onData).not.toHaveBeenCalled();
  });

  it('calls onError with whatever the fetcher threw', async () => {
    const onError = vi.fn();
    const cause = new Error('boom');
    const { result } = renderHook(() =>
      useRetryableFetch(() => Promise.reject(cause), [], '', { onError }),
    );

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(onError).toHaveBeenCalledWith(cause);
    expect(result.current.cause).toBe(cause);
  });

  it('does not call onError on a successful fetch', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useRetryableFetch(() => Promise.resolve('ok'), [], '', { onError }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(onError).not.toHaveBeenCalled();
  });

  it('re-reads onData every render, so an inline arrow sees fresh state', async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(() => Promise.resolve('value'));
    const { rerender, result } = renderHook(
      ({ tag }: { tag: string }) =>
        useRetryableFetch(fetcher, [], '', { onData: v => seen.push(`${tag}:${v}`) }),
      { initialProps: { tag: 'a' } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen).toEqual(['a:value']);

    rerender({ tag: 'b' });
    // A changed callback identity must not re-run the fetch...
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });
    // ...but the next load must use the latest one.
    expect(seen).toEqual(['a:value', 'b:value']);
  });

  it('does not seed from a stale response that lands after a newer request', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const calls = [first.promise, second.promise];
    let call = 0;
    const onData = vi.fn();

    const { result } = renderHook(() => useRetryableFetch(() => calls[call++], [], '', { onData }));

    await act(async () => {
      void result.current.refetch();
    });

    await act(async () => {
      second.resolve('newer');
      first.resolve('older');
      await second.promise;
      await first.promise;
    });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith('newer');
    expect(result.current.data).toBe('newer');
  });

  it('does not report a stale failure that lands after a newer request', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const calls = [first.promise, second.promise];
    let call = 0;
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useRetryableFetch(() => calls[call++], [], '', { onError }),
    );

    await act(async () => {
      void result.current.refetch();
    });

    await act(async () => {
      second.resolve('newer');
      first.reject(new Error('stale boom'));
      await second.promise;
      await first.promise.catch(() => {});
    });

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBe(false);
  });
});
