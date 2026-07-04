'use client';

import { Button } from '@/components/ui/button';
import { useReportRenderError } from '@/hooks/use-report-render-error';
import { useTranslations } from '@/hooks/use-translations';

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
  const t = useTranslations();
  useReportRenderError('workspace-error-boundary', error);

  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {t('layout.workspaceError.title')}
      </h2>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {t('layout.workspaceError.detail')}
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-zinc-500">
          {t('errors.errorRef')} {error.digest}
        </p>
      ) : null}
      <Button onClick={() => reset()}>{t('layout.workspaceError.retry')}</Button>
    </div>
  );
}
