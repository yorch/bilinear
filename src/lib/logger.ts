import * as Sentry from '@sentry/nextjs';

/**
 * Lightweight client-side logger.
 *
 * The server logger (`@/server/lib/logger`, pino) must never be imported into
 * client code. This is its browser counterpart: it writes to the console in
 * development for local visibility and forwards to Sentry in production so
 * client-side failures are aggregated instead of vanishing into users'
 * devtools. Sentry itself is a no-op unless a DSN is configured and
 * NODE_ENV === 'production' (see sentry.client.config).
 *
 * Usage:
 *   const log = createClientLogger('SyncManager');
 *   log.error('Bootstrap failed', err);
 *   log.warn('enqueue before setActiveSession');
 */
const isDev = process.env.NODE_ENV !== 'production';

type Fields = Record<string, unknown>;

/**
 * Shape a caught value + extra fields into a flat Sentry `extra` bag. Errors
 * are reduced to their message (the Error object itself, when present, is sent
 * via captureException — not stuffed into extra).
 */
function toExtra(err: unknown, fields?: Fields): Record<string, unknown> {
  const errField = err instanceof Error ? { err: err.message } : err !== undefined ? { err } : {};
  return { ...errField, ...fields };
}

export interface ClientLogger {
  error(message: string, err?: unknown, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, err?: unknown, fields?: Fields): void;
}

export function createClientLogger(scope: string): ClientLogger {
  const tag = `[${scope}]`;
  return {
    error(message, err, fields) {
      if (isDev) {
        console.error(tag, message, err ?? '', fields ?? '');
      }
      if (err instanceof Error) {
        Sentry.captureException(err, { extra: { message, ...fields }, tags: { scope } });
      } else {
        Sentry.captureMessage(`${tag} ${message}`, {
          extra: toExtra(err, fields),
          level: 'error',
          tags: { scope },
        });
      }
    },
    info(message, fields) {
      if (isDev) {
        console.info(tag, message, fields ?? '');
      }
    },
    warn(message, err, fields) {
      if (isDev) {
        console.warn(tag, message, err ?? '', fields ?? '');
      }
      // Warnings are degraded-but-expected states (retries, quota-limited
      // IndexedDB, first-enqueue races). Leave a breadcrumb so the context
      // attaches to any later error, rather than emitting a Sentry event per
      // warn — otherwise high-frequency benign warns (e.g. TransactionQueue
      // persist failures in private-browsing) would flood Sentry.
      Sentry.addBreadcrumb({
        category: scope,
        data: toExtra(err, fields),
        level: 'warning',
        message,
      });
    },
  };
}
