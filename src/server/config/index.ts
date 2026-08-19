/**
 * Process-wide `ConfigService` singleton plus its Redis subscription.
 *
 * Every process that reads configuration calls `startConfigInvalidation()` once
 * at boot — the Next.js server, `ws:server` and `yjs:server` alike. The
 * subscription is unconditional and independent of the sync channel, which is
 * subscribed per-org only while that org has a live client.
 */

import { childLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { CONFIG_INVALIDATE_CHANNEL, ConfigService } from './config.service';

export type { ConfigScopeIds } from './config.service';
export {
  CONFIG_CACHE_TTL_MS,
  CONFIG_INVALIDATE_CHANNEL,
  ConfigService,
  InvalidScopeError,
  SettingNotWritableError,
  UnknownSettingError,
} from './config.service';

const log = childLogger({ module: 'config' });

const globalForConfig = globalThis as unknown as {
  configService: ConfigService | undefined;
  configSubscriber: ReturnType<typeof redis.duplicate> | undefined;
};

export const config: ConfigService =
  globalForConfig.configService ?? new ConfigService(prisma, redis);

if (process.env.NODE_ENV !== 'production') {
  globalForConfig.configService = config;
}

/**
 * Subscribe this process to config invalidations. Idempotent — a second call
 * is a no-op, so the Next.js dev server's module reloading cannot stack
 * subscribers.
 *
 * Uses a duplicated connection because a Redis client in subscriber mode can
 * issue no other commands, and the shared client is used for everything else.
 */
export function startConfigInvalidation(): void {
  if (globalForConfig.configSubscriber) {
    return;
  }
  const subscriber = redis.duplicate();
  globalForConfig.configSubscriber = subscriber;

  subscriber.on('error', err => {
    log.error({ err }, 'Config invalidation subscriber error');
  });

  subscriber.subscribe(CONFIG_INVALIDATE_CHANNEL, err => {
    if (err) {
      log.error({ err }, 'Failed to subscribe to config invalidation');
      return;
    }
    log.info({ channel: CONFIG_INVALIDATE_CHANNEL }, 'Config invalidation subscribed');
  });

  subscriber.on('message', (channel, message) => {
    if (channel === CONFIG_INVALIDATE_CHANNEL) {
      config.applyInvalidation(message);
    }
  });
}
