import { beforeEach, describe, expect, it, vi } from 'vitest';

const counters = new Map<string, number>();
vi.mock('../../middleware/rate-limit', () => ({
  // Same contract as the real INCR-based limiter, minus Redis.
  checkFixedWindow: async (key: string, limit: number) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    return { count, exceeded: count > limit };
  },
}));

import type { GraphQLContext } from '../context';
import {
  WEBHOOK_TEST_LIMIT_PER_HOOK,
  WEBHOOK_TEST_LIMIT_PER_USER,
  webhookResolvers,
} from './webhook';

function ctxFor(userId = 'user-1') {
  const sendTest = vi.fn().mockResolvedValue({ id: 'd1', status: 'success' });
  const log = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    clientIp: null,
    orgId: 'org-1',
    orgRole: 'admin',
    services: {
      auditLog: { log },
      webhook: { findById: vi.fn().mockResolvedValue({ name: 'hook' }), sendTest },
    },
    userId,
  } as unknown as GraphQLContext;
  return { ctx, sendTest };
}

const test = (ctx: GraphQLContext, id: string) =>
  webhookResolvers.Mutation.webhookTest(undefined, { id }, ctx);

describe('webhookTest rate limit', () => {
  beforeEach(() => counters.clear());

  it('lets only N of a parallel burst against one webhook through', async () => {
    const { ctx, sendTest } = ctxFor();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => test(ctx, 'hook-1')));
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(WEBHOOK_TEST_LIMIT_PER_HOOK);
    expect(sendTest).toHaveBeenCalledTimes(WEBHOOK_TEST_LIMIT_PER_HOOK);
    expect(rejected).toHaveLength(8 - WEBHOOK_TEST_LIMIT_PER_HOOK);
    expect(rejected[0]?.reason.extensions.code).toBe('RATELIMITED');
  });

  it('caps one user across many webhooks, but not another user', async () => {
    const { ctx, sendTest } = ctxFor('user-1');
    let ok = 0;
    for (let i = 0; i < WEBHOOK_TEST_LIMIT_PER_USER + 5; i++) {
      try {
        await test(ctx, `hook-${i}`);
        ok++;
      } catch (err) {
        expect((err as { extensions: { code: string } }).extensions.code).toBe('RATELIMITED');
      }
    }
    expect(ok).toBe(WEBHOOK_TEST_LIMIT_PER_USER);
    expect(sendTest).toHaveBeenCalledTimes(WEBHOOK_TEST_LIMIT_PER_USER);
    const other = ctxFor('user-2');
    await expect(test(other.ctx, 'hook-x')).resolves.toBeDefined();
  });
});
