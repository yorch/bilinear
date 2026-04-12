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

const pinoLogger = pino(
  {
    base: { service: 'issue-tracker' },
    level: process.env.LOG_LEVEL ?? 'info',
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
 * Wraps pino's error/fatal methods to also capture errors in Sentry.
 * All other log methods pass through unchanged.
 */
function withSentryCapture(base: pino.Logger): pino.Logger {
  const proxy = Object.create(base) as pino.Logger;

  const captureAndLog =
    (method: 'error' | 'fatal') =>
    (...args: Parameters<pino.LogFn>) => {
      // Extract the Error object if present (pino: logger.error({ err }, 'msg') or logger.error(err, 'msg'))
      const first = args[0];
      if (first instanceof Error) {
        Sentry.captureException(first);
      } else if (first !== null && typeof first === 'object' && 'err' in first && (first as Record<string, unknown>).err instanceof Error) {
        Sentry.captureException((first as Record<string, unknown>).err);
      }
      return (base[method] as (...a: unknown[]) => void)(...args);
    };

  proxy.error = captureAndLog('error') as pino.LogFn;
  proxy.fatal = captureAndLog('fatal') as pino.LogFn;

  return proxy;
}

export const logger = withSentryCapture(pinoLogger);

/**
 * Create a child logger with pre-bound fields.
 * Useful for request-scoped logging (e.g., attaching orgId/userId once).
 *
 *   const reqLogger = childLogger({ orgId, userId });
 *   reqLogger.info('Issue created');
 */
export function childLogger(bindings: Record<string, unknown>) {
  return withSentryCapture(pinoLogger.child(bindings));
}
