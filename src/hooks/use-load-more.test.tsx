import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useLoadMore } from './use-load-more';

interface Page {
  items: string[];
  nextCursor: string | null;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function setup(fetchMore: (cursor: string, filter: string) => Promise<Page>) {
  const onError = vi.fn();
  const hook = renderHook(
    ({ filter }: { filter: string }) => {
      const [page, setPage] = useState<Page>({ items: [`${filter}-0`], nextCursor: 'c1' });
      const more = useLoadMore<Page>({
        fetchMore: cursor => fetchMore(cursor, filter),
        merge: (prev, next) => ({
          items: [...prev.items, ...next.items],
          nextCursor: next.nextCursor,
        }),
        onError,
        page,
        resetKey: filter,
        setPage,
      });
      return { ...more, page, setPage };
    },
    { initialProps: { filter: 'a' } },
  );
  return { hook, onError };
}

describe('useLoadMore', () => {
  it('appends the next page', async () => {
    const { hook } = setup(async () => ({ items: ['a-1'], nextCursor: null }));
    await act(async () => {
      await hook.result.current.loadMore();
    });
    expect(hook.result.current.page.items).toEqual(['a-0', 'a-1']);
    expect(hook.result.current.loadingMore).toBe(false);
  });

  it('drops a response that arrives after the filter changed', async () => {
    const slow = deferred<Page>();
    const { hook } = setup(() => slow.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.loadMore();
    });
    expect(hook.result.current.loadingMore).toBe(true);

    // The user applies a new filter; its first page replaces the list.
    hook.rerender({ filter: 'b' });
    act(() => {
      hook.result.current.setPage(() => ({ items: ['b-0'], nextCursor: 'c1' }));
    });
    expect(hook.result.current.loadingMore).toBe(false);

    await act(async () => {
      slow.resolve({ items: ['a-STALE'], nextCursor: null });
      await pending;
    });
    expect(hook.result.current.page.items).toEqual(['b-0']);
    expect(hook.result.current.page.nextCursor).toBe('c1');
  });

  it('does not toast a stale failure', async () => {
    const slow = deferred<Page>();
    const { hook, onError } = setup(() => slow.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.loadMore();
    });
    hook.rerender({ filter: 'b' });
    await act(async () => {
      slow.reject(new Error('boom'));
      await pending;
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores a second click while the same filter is already loading', async () => {
    const slow = deferred<Page>();
    const fetchMore = vi.fn(() => slow.promise);
    const { hook } = setup(fetchMore);
    let first!: Promise<void>;
    act(() => {
      first = hook.result.current.loadMore();
      void hook.result.current.loadMore();
    });
    expect(fetchMore).toHaveBeenCalledTimes(1);
    await act(async () => {
      slow.resolve({ items: ['a-1'], nextCursor: null });
      await first;
    });
    expect(hook.result.current.page.items).toEqual(['a-0', 'a-1']);
  });

  it('lets the NEW filter load more while the old filter request is still in flight', async () => {
    const slow = deferred<Page>();
    const fetchMore = vi.fn((_c: string, filter: string) =>
      filter === 'a' ? slow.promise : Promise.resolve({ items: ['b-1'], nextCursor: null }),
    );
    const { hook } = setup(fetchMore);
    act(() => {
      void hook.result.current.loadMore();
    });
    hook.rerender({ filter: 'b' });
    act(() => {
      hook.result.current.setPage(() => ({ items: ['b-0'], nextCursor: 'c1' }));
    });
    await act(async () => {
      await hook.result.current.loadMore();
    });
    expect(hook.result.current.page.items).toEqual(['b-0', 'b-1']);
  });

  it('drops a response whose base page was replaced by a refetch', async () => {
    const slow = deferred<Page>();
    const { hook } = setup(() => slow.promise);
    let pending!: Promise<void>;
    act(() => {
      pending = hook.result.current.loadMore();
    });
    act(() => {
      hook.result.current.setPage(() => ({ items: ['a-fresh'], nextCursor: 'c9' }));
    });
    await act(async () => {
      slow.resolve({ items: ['a-old-next'], nextCursor: null });
      await pending;
    });
    expect(hook.result.current.page.items).toEqual(['a-fresh']);
  });
});
