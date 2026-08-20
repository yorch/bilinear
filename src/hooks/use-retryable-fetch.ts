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

interface UseRetryableFetchOptions<T> {
  /**
   * Run after each successful load, with the result. For the fetch-then-**seed**
   * pages (workspace/team settings, security, integrations, roadmap, the
   * standalone issue route) that spread one response across many `useState`
   * form fields rather than rendering `data` directly: without this they had to
   * hand-roll the whole loading/error/refetch triple, because the seeding could
   * only live inside the fetcher — where a failed request would already have
   * been swallowed, and where "fetch" and "write local state" get tangled.
   *
   * Read through a ref, so passing an inline arrow does not re-run the fetch.
   * Runs only for a response that is still current — a stale one that resolves
   * after a newer request has started is discarded without seeding.
   */
  onData?: (data: T) => void;
  /**
   * Run when a load fails, with whatever the fetcher threw. The hook already
   * exposes `error`/`cause` for rendering; this is for the callers that also
   * need a one-shot reaction to the failure itself — a toast, a log — which
   * rendering-derived state cannot express, because it would re-fire on every
   * render. Same ref treatment and same staleness rule as `onData`.
   */
  onError?: (cause: unknown) => void;
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
  options?: UseRetryableFetchOptions<T>,
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
  const onDataRef = useRef(options?.onData);
  onDataRef.current = options?.onData;
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

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
          onDataRef.current?.(result);
        }
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setFailure({ cause: err });
          onErrorRef.current?.(err);
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
    // `failure === null`, not `failure?.cause ?? null` — the box exists precisely
    // so a fetcher that throws `null`/`undefined` stays distinguishable from
    // "no failure", and collapsing it here would have made `error === true`
    // report `cause === null`, contradicting the box two lines up.
    cause: failure === null ? null : failure.cause,
    data,
    error: failure !== null,
    loading,
    refetch,
    setData,
  };
}
