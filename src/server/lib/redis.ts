import Redis, { type RedisOptions } from 'ioredis';
import { childLogger } from './logger';

const log = childLogger({ module: 'redis' });

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function parseRedisUrl(urlString: string): RedisOptions {
  const url = new URL(urlString);
  const options: RedisOptions = {
    host: url.hostname,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    port: url.port ? Number(url.port) : 6379,
  };
  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (url.pathname && url.pathname.length > 1) {
    options.db = Number(url.pathname.slice(1));
  }
  if (url.protocol === 'rediss:') {
    options.tls = {};
  }
  return options;
}

function createRedisClient() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new Redis(parseRedisUrl(url));

  client.on('error', err => {
    log.error({ err }, 'Connection error');
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
