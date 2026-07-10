import { useEffect } from 'react';
import { createClientLogger } from '@/lib/logger';

/**
 * Report a render error caught by a Next.js `error.tsx` boundary to Sentry
 * (and the dev console). Next.js swallows boundary errors before the global
 * window handlers see them, so Sentry's automatic capture never fires — the
 * boundary must report explicitly. Shared by the root and workspace
 * boundaries so the message and payload stay identical.
 */
export function useReportRenderError(scope: string, error: Error & { digest?: string }): void {
  useEffect(() => {
    createClientLogger(scope).error('Unhandled render error', error, { digest: error.digest });
  }, [scope, error]);
}
