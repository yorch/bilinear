'use client';

import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
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
    <div className="flex h-full flex-1 items-center justify-center">
      <EmptyState
        action={
          <div className="flex gap-2">
            <Button onClick={() => reset()} size="sm">
              {t('layout.workspaceError.retry')}
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href="/">{t('errors.goHome')}</a>
            </Button>
          </div>
        }
        description={
          <>
            {t('layout.workspaceError.detail')}
            {error.digest ? (
              <span className="mt-2 block font-mono">
                {t('errors.errorRef')} {error.digest}
              </span>
            ) : null}
          </>
        }
        icon={<TriangleAlert className="h-5 w-5" />}
        title={t('layout.workspaceError.title')}
      />
    </div>
  );
}
