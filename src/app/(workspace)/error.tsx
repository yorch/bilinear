'use client';

import { Button } from '@/components/ui/button';
import { useReportRenderError } from '@/hooks/use-report-render-error';

/**
 * Workspace-segment error boundary. Catches errors thrown inside the
 * workspace layout subtree without taking down the root layout's theme +
 * toaster providers, so the user can recover without a full reload.
 *
 * Reporting to Sentry is handled by useReportRenderError — Next.js swallows
 * boundary errors before Sentry's global handlers see them.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportRenderError('workspace-error-boundary', error);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Couldn't load this workspace view
      </h2>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        Something went wrong inside the app. Retrying re-mounts just this section without losing the
        rest of your session.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-zinc-500">Error ref: {error.digest}</p>
      ) : null}
      <Button onClick={() => reset()}>Retry</Button>
    </div>
  );
}
