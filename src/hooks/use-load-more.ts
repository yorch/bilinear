'use client';

import { useCallback, useRef, useState } from 'react';

interface UseLoadMoreOptions<P extends { nextCursor: string | null }> {
  /** Appends the fetched page to the current one. */
  merge: (prev: P, next: P) => P;
  /** Called with a failed fetch for the CURRENT key only (stale failures are dropped). */
  onError: (err: unknown) => void;
  /** The page currently shown; its `nextCursor` is what "Load more" continues from. */
  page: P;
  /** Fetches the page after `cursor` with the filters of the render that built this call. */
  fetchMore: (cursor: string) => Promise<P>;
  /**
   * Identity of the filters/query the shown page belongs to. When it changes,
   * every in-flight "Load more" for the old value is discarded on arrival, so a
   * slow response can never append the previous filter's rows to the new list.
   */
  resetKey: string;
  setPage: (update: (prev: P) => P) => void;
}

/**
 * "Load more" for a cursor-paged list whose filters can change under it.
 *
 * Three guards, each of which has bitten: (1) the response is dropped when the
 * filter key changed while it was in flight; (2) it is dropped when the page it
 * was meant to extend has since been replaced (retry, refetch); (3) a second
 * click while the same key is already loading is ignored.
 */
export function useLoadMore<P extends { nextCursor: string | null }>({
  fetchMore,
  merge,
  onError,
  page,
  resetKey,
  setPage,
}: UseLoadMoreOptions<P>) {
  const keyRef = useRef(resetKey);
  keyRef.current = resetKey;
  const inFlightKey = useRef<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    const cursor = page.nextCursor;
    const startKey = resetKey;
    if (!cursor || inFlightKey.current === startKey) {
      return;
    }
    inFlightKey.current = startKey;
    setLoadingKey(startKey);
    try {
      const next = await fetchMore(cursor);
      if (keyRef.current === startKey) {
        setPage(prev => (prev.nextCursor === cursor ? merge(prev, next) : prev));
      }
    } catch (err) {
      if (keyRef.current === startKey) {
        onError(err);
      }
    } finally {
      if (inFlightKey.current === startKey) {
        inFlightKey.current = null;
      }
      setLoadingKey(current => (current === startKey ? null : current));
    }
  }, [fetchMore, merge, onError, page.nextCursor, resetKey, setPage]);

  return { loadMore, loadingMore: loadingKey === resetKey };
}
