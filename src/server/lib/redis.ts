import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient() {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  client.on('error', err => {
    console.error('[Redis] Connection error:', err);
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}
