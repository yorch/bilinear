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
  /**
   * Whatever the fetcher threw, unchanged. `error` stays the boolean nearly
   * every caller switches on; this is for the ones that need to know *what*
   * failed. Pre-extracting `.message` here instead threw away the part callers
   * actually needed: `gqlQuery` throws a `GqlError` carrying
   * `extensions.code`, so a page wanting to tell "forbidden" from "broken" had
   * to re-catch inside its own fetcher to recover a code this hook was already
   * holding. Pair with `getErrorMessage(cause, fallback)` to render it and
   * `isPermissionError(cause)` to branch on it (both from `@/lib`).
   */
  cause: unknown;
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
  // Boxed rather than stored bare so `null` and "threw a null" stay
  // distinguishable, and so `error` can be derived from it at the return rather
  // than tracked as a second state that has to be kept in lockstep.
  const [failure, setFailure] = useState<{ cause: unknown } | null>(null);
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
          setFailure({ cause: err });
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
    cause: failure?.cause ?? null,
    data,
    error: failure !== null,
    loading,
    refetch,
    setData,
  };
}
