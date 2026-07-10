import { AsyncLocalStorage } from 'node:async_hooks';
import * as Sentry from '@sentry/nextjs';
import pino from 'pino';

/**
 * Structured JSON logger for server-side use.
 *
 * In development (NODE_ENV !== 'production'), logs are pretty-printed via
 * pino-pretty automatically. Set LOG_PRETTY=1 to enable it in production too.
 * In production (default), output is
 * newline-delimited JSON suitable for log aggregators (Datadog, CloudWatch, etc.).
 *
 * Usage:
 *   import { logger } from '@/server/lib/logger';
 *   logger.info({ userId }, 'User logged in');
 *   logger.error({ err }, 'Unhandled error');
 *
 * Log levels: trace < debug < info < warn < error < fatal
 * Default level: info (override with LOG_LEVEL env var)
 */
const isDev = process.env.NODE_ENV !== 'production';
const usePretty = isDev || process.env.LOG_PRETTY === '1';

/**
 * Request-scoped bindings (requestId, orgId, userId, …). Anything stored here
 * via {@link runWithRequestContext} is merged onto every log line emitted
 * inside the async call tree — including logs from deep service code — so a
 * single request's output can be correlated without threading a logger
 * through every function. See the `mixin` below.
 */
export const requestContext = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Run `fn` with the given bindings attached to every log line emitted during
 * its (async) execution. Bindings from an outer scope are shallow-merged so
 * nested calls can add fields without dropping the request id.
 */
export function runWithRequestContext<T>(bindings: Record<string, unknown>, fn: () => T): T {
  const parent = requestContext.getStore();
  return requestContext.run({ ...parent, ...bindings }, fn);
}

// Numeric pino levels at/above which we forward to Sentry (error=50, fatal=60).
const SENTRY_LEVEL_THRESHOLD = 50;

/**
 * Forward an error/fatal log's Error object (if any) to Sentry. Handles both
 * `logger.error(err, 'msg')` and `logger.error({ err }, 'msg')` shapes.
 */
function captureFromArgs(args: unknown[]): void {
  const first = args[0];
  if (first instanceof Error) {
    Sentry.captureException(first);
  } else if (
    first !== null &&
    typeof first === 'object' &&
    'err' in first &&
    (first as Record<string, unknown>).err instanceof Error
  ) {
    Sentry.captureException((first as Record<string, unknown>).err);
  }
}

/**
 * Field paths that must never reach a log sink in plaintext — credentials plus
 * PII (email). pino applies these before serialization. Defense-in-depth: it
 * stops a future `log.info({ headers })` or an object that happens to carry a
 * credential/email from leaking. Kept conservative so it doesn't clobber
 * unrelated fields (e.g. GraphQL `extensions.code`). Note this can't catch
 * secrets embedded inside a value (e.g. a token in a URL string) — those must
 * still be kept out of logs at the call site.
 */
// Sensitive leaf keys. Each is redacted both at the top level and one level
// deep (`*.<key>`, which also covers `headers.authorization` etc.), so the
// list stays in one place and can't desync a base key from its wildcard.
const SENSITIVE_KEYS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'secret',
  'apiKey',
  'authorization',
  'cookie',
  'signature',
  'email',
];

const REDACT_PATHS = [
  ...SENSITIVE_KEYS.flatMap(key => [key, `*.${key}`]),
  // Two levels deep — not covered by the single-level `*.` wildcard above.
  'req.headers.authorization',
  'req.headers.cookie',
];

export const logger = pino(
  {
    base: { service: 'issue-tracker' },
    // logMethod runs in the main thread before serialization/transport and is
    // inherited by every child logger, so Sentry capture applies uniformly —
    // no proxy, and `.child()` can't bypass it.
    hooks: {
      logMethod(inputArgs, method, level) {
        if (level >= SENTRY_LEVEL_THRESHOLD) {
          captureFromArgs(inputArgs);
        }
        return method.apply(this, inputArgs);
      },
    },
    level: process.env.LOG_LEVEL ?? 'info',
    // Merge request-scoped bindings (requestId/orgId/userId) onto every line.
    mixin: () => requestContext.getStore() ?? {},
    redact: { censor: '[REDACTED]', paths: REDACT_PATHS },
  },
  usePretty
    ? pino.transport({
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:HH:MM:ss',
        },
        target: 'pino-pretty',
      })
    : undefined,
);

/**
 * Create a child logger with pre-bound fields.
 * Useful for module- or request-scoped logging (e.g., attaching a module name
 * or orgId/userId once). Children inherit the Sentry-capture hook and redaction.
 *
 *   const log = childLogger({ module: 'issue' });
 *   log.info('Issue created');
 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
