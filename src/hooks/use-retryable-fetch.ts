'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface RefetchOptions {
  /**
   * Skip flipping `loading` back to true — for a quiet background refresh
   * (e.g. re-syncing after a related mutation) rather than the initial or
   * parent-triggered load.
   */
  silent?: boolean;
}

interface UseRetryableFetchResult<T> {
  data: T;
  error: boolean;
  loading: boolean;
  refetch: (opts?: RefetchOptions) => Promise<void>;
  setData: React.Dispatch<React.SetStateAction<T>>;
}

/**
 * Fetch-on-mount (and on `deps` change) with a distinguishable error state —
 * shared by the issue-detail sections (reactions, activity, comments,
 * attachments) that render a "Couldn't load — Retry" (`InlineRetry`) instead
 * of treating a failed load as a legitimate empty state. `refetch` is also
 * what callers re-invoke after a related mutation (pass `{ silent: true }`
 * to skip re-flashing the loading state for those quiet background
 * refreshes). A monotonic request id discards a stale in-flight response
 * that resolves after a newer one already landed.
 */
export function useRetryableFetch<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  initialValue: T,
): UseRetryableFetchResult<T> {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestIdRef = useRef(0);
  // Read through a ref so `refetch`'s identity is governed solely by `deps`
  // (below) rather than by `fetcher`, which the caller recreates every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(
    async (opts?: RefetchOptions) => {
      const requestId = ++requestIdRef.current;
      if (!opts?.silent) {
        setLoading(true);
      }
      try {
        const result = await fetcherRef.current();
        if (requestId === requestIdRef.current) {
          setData(result);
          setError(false);
        }
      } catch {
        if (requestId === requestIdRef.current) {
          setError(true);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [...deps],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, error, loading, refetch, setData };
}
