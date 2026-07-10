'use client';

import { Button } from '@/components/ui/button';
import { useReportRenderError } from '@/hooks/use-report-render-error';
import { useTranslations } from '@/hooks/use-translations';

/**
 * Root error boundary. Caught by Next when any non-server-component throws
 * during render and the error wasn't handled by a deeper segment-level
 * error.tsx. The `reset` callback re-runs the segment from a fresh state.
 *
 * Reporting to Sentry is handled by useReportRenderError — Next.js swallows
 * boundary errors before Sentry's global handlers see them.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  useReportRenderError('app-error-boundary', error);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold text-foreground">{t('errors.somethingWentWrong')}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{t('errors.unexpectedErrorDetail')}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          {t('errors.errorRef')} {error.digest}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={() => reset()}>{t('errors.tryAgain')}</Button>
        <Button
          onClick={() => {
            window.location.href = '/';
          }}
          variant="outline"
        >
          {t('errors.goHome')}
        </Button>
      </div>
    </div>
  );
}
