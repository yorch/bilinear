'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary. Caught by Next when any non-server-component throws
 * during render and the error wasn't handled by a deeper segment-level
 * error.tsx. The `reset` callback re-runs the segment from a fresh state.
 *
 * Render-only — Sentry already wires `captureException` via the
 * sentry.client.config; we don't double-log here.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[app error boundary]', error);
    }
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        The page hit an unexpected error. Try again — if it keeps happening,
        reload or come back in a minute.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-zinc-500">
          Error ref: {error.digest}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button
          variant="outline"
          onClick={() => {
            window.location.href = '/';
          }}
        >
          Go home
        </Button>
      </div>
    </div>
  );
}
