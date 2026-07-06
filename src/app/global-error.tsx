'use client';

import { useReportRenderError } from '@/hooks/use-report-render-error';

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself
 * (providers, fonts, Toaster). Segment error.tsx files never see those.
 * Runs outside every provider — no theme, no locale, possibly no global
 * stylesheet — so copy is English-only and styling is inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportRenderError('global-error-boundary', error);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: 'center',
          background: 'oklch(1 0 0)',
          color: 'oklch(0.21 0.006 285.885)',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          gap: '1rem',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '1.5rem',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p
          style={{
            color: 'oklch(0.442 0.017 285.786)',
            fontSize: '0.875rem',
            margin: 0,
            maxWidth: '28rem',
          }}
        >
          The app hit an unexpected error while starting up. Try again — if it keeps happening,
          reload or come back in a minute.
        </p>
        {error.digest ? (
          <p
            style={{
              color: 'oklch(0.552 0.016 285.938)',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.75rem',
            }}
          >
            Error ref: {error.digest}
          </p>
        ) : null}
        <button
          onClick={() => reset()}
          style={{
            background: 'oklch(0.21 0.006 285.885)',
            border: 'none',
            borderRadius: '0.375rem',
            color: 'oklch(1 0 0)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            padding: '0.5rem 1rem',
          }}
          type="button"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
