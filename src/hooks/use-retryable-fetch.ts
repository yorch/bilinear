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
  /**
   * The thrown error's message, when there was one. `error` stays the boolean
   * every existing caller switches on; this is for surfaces where the specific
   * failure is worth showing rather than a generic "couldn't load" — the
   * platform-admin console, where the server's message is the diagnostic.
   */
  errorMessage: string | null;
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
  // One piece of state, not two kept in lockstep: `error` is derived at the
  // return. Two `useState`s meant three call sites below had to remember to
  // update both, and updating one without the other leaves stale text behind.
  const [failure, setFailure] = useState<{ message: string | null } | null>(null);
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
        // Clear the previous failure as the retry starts. Without this a caller
        // that renders `loading` and `error` as siblings (rather than as an
        // if/else) shows the spinner and the "couldn't load — Retry" row at the
        // same time, and a caller that early-returns on `error` shows no sign
        // the retry is in flight at all.
        setFailure(null);
      }
      try {
        const result = await fetcherRef.current();
        if (requestId === requestIdRef.current) {
          setData(result);
          setFailure(null);
        }
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setFailure({ message: err instanceof Error ? err.message : null });
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

  return {
    data,
    error: failure !== null,
    errorMessage: failure?.message ?? null,
    loading,
    refetch,
    setData,
  };
}
