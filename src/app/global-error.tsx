'use client';

import { useReportRenderError } from '@/hooks/use-report-render-error';

/**
 * Last-resort boundary for errors thrown in the ROOT layout itself
 * (providers, fonts, Toaster). Segment error.tsx files never see those.
 * Runs outside every provider — no theme, no locale, possibly no global
 * stylesheet — so copy is English-only and styling is an inline stylesheet
 * (classes, not style attributes, so `prefers-color-scheme` can restyle it:
 * a dark-mode user used to get a white flash here).
 */
const STYLES = `
  .ge-body {
    --ge-bg: oklch(1 0 0);
    --ge-fg: oklch(0.21 0.006 285.885);
    --ge-muted: oklch(0.442 0.017 285.786);
    --ge-faint: oklch(0.552 0.016 285.938);
    --ge-border: oklch(0.85 0.01 285);
    align-items: center;
    background: var(--ge-bg);
    color: var(--ge-fg);
    display: flex;
    flex-direction: column;
    font-family: ui-sans-serif, system-ui, sans-serif;
    gap: 1rem;
    justify-content: center;
    margin: 0;
    min-height: 100vh;
    padding: 1.5rem;
    text-align: center;
  }
  @media (prefers-color-scheme: dark) {
    .ge-body {
      --ge-bg: oklch(0.16 0.01 285);
      --ge-fg: oklch(0.96 0.005 285);
      --ge-muted: oklch(0.75 0.01 285);
      --ge-faint: oklch(0.68 0.01 285);
      --ge-border: oklch(0.35 0.01 285);
    }
  }
  .ge-title { font-size: 1.25rem; font-weight: 600; margin: 0; }
  .ge-detail { color: var(--ge-muted); font-size: 0.875rem; margin: 0; max-width: 28rem; }
  .ge-ref { color: var(--ge-faint); font-family: ui-monospace, monospace; font-size: 0.75rem; margin: 0; }
  .ge-actions { display: flex; gap: 0.5rem; }
  .ge-btn {
    background: transparent;
    border: 1px solid var(--ge-border);
    border-radius: 0.375rem;
    color: var(--ge-fg);
    cursor: pointer;
    font-size: 0.875rem;
    padding: 0.5rem 1rem;
    text-decoration: none;
  }
  .ge-btn-primary { background: var(--ge-fg); border-color: var(--ge-fg); color: var(--ge-bg); }
  .ge-btn:focus-visible { outline: 2px solid var(--ge-fg); outline-offset: 2px; }
`;

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
      <head>
        <style>{STYLES}</style>
      </head>
      <body className="ge-body">
        <h1 className="ge-title">Something went wrong</h1>
        <p className="ge-detail">
          The app hit an unexpected error while starting up. Try again — if it keeps happening,
          reload or come back in a minute.
        </p>
        {error.digest ? <p className="ge-ref">Error ref: {error.digest}</p> : null}
        <div className="ge-actions">
          <button className="ge-btn ge-btn-primary" onClick={() => reset()} type="button">
            Try again
          </button>
          {/* A plain anchor: the router may be what failed to start. */}
          <a className="ge-btn" href="/">
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
