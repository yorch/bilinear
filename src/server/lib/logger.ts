import pino from 'pino';

/**
 * Structured JSON logger for server-side use.
 *
 * In development, logs are pretty-printed via pino-pretty when the
 * LOG_PRETTY env var is set. In production (default), output is
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

export const logger = pino(
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
 * Create a child logger with pre-bound fields.
 * Useful for request-scoped logging (e.g., attaching orgId/userId once).
 *
 *   const reqLogger = childLogger({ orgId, userId });
 *   reqLogger.info('Issue created');
 */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
