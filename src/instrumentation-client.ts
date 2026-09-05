// Browser-side Sentry bootstrap. Next.js 15.3+ loads `instrumentation-client`
// itself (Turbopack included); the old `sentry.client.config.ts` at the repo
// root was only ever picked up by the legacy webpack plugin injection, so with
// Next 16's default Turbopack build the browser SDK never initialised — no
// client errors, replays or traces reached Sentry even with a DSN set.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NODE_ENV === 'production',
  environment: process.env.NODE_ENV,
  integrations: [Sentry.replayIntegration()],
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  tracesSampleRate: 0.1,
});

// Lets the SDK attribute a client-side navigation to the route it starts.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
