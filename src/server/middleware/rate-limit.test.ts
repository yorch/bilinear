import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the redis singleton before the module under test imports it.
// `runPipeline` is the spy backing the pipeline `.exec()` method — each
// test pre-programs its return so the limiter sees a known reply.
const runPipeline = vi.fn();
const expire = vi.fn().mockReturnThis();
const incr = vi.fn().mockReturnThis();
const incrby = vi.fn().mockReturnThis();
const multi = vi.fn().mockReturnValue({ exec: runPipeline, expire, incr, incrby });

vi.mock('../lib/redis', () => ({
  redis: { multi },
}));

const { checkAuthMutationLimit, checkFixedWindow } = await import('./rate-limit');

describe('checkFixedWindow', () => {
  beforeEach(() => {
    runPipeline.mockReset();
    incr.mockClear();
    expire.mockClear();
    multi.mockClear();
  });

  it('returns exceeded=false while under the limit', async () => {
    runPipeline.mockResolvedValue([
      [null, 3], // INCR returned 3
      [null, 1],
    ]);

    const result = await checkFixedWindow('rl:test', 5, 60);

    expect(result).toEqual({ count: 3, exceeded: false });
  });

  it('returns exceeded=true once the count crosses the limit', async () => {
    runPipeline.mockResolvedValue([
      [null, 6],
      [null, 1],
    ]);

    const result = await checkFixedWindow('rl:test', 5, 60);

    expect(result).toEqual({ count: 6, exceeded: true });
  });

  it('fails open when Redis throws so an outage does not block traffic', async () => {
    runPipeline.mockRejectedValue(new Error('redis is down'));

    const result = await checkFixedWindow('rl:test', 5, 60);

    expect(result).toEqual({ count: 0, exceeded: false });
  });

  it('fails open when the pipeline returns null (unexpected state)', async () => {
    runPipeline.mockResolvedValue(null);

    const result = await checkFixedWindow('rl:test', 5, 60);

    expect(result.exceeded).toBe(false);
  });
});

describe('checkAuthMutationLimit', () => {
  beforeEach(() => {
    runPipeline.mockReset();
    incr.mockClear();
    expire.mockClear();
    multi.mockClear();
  });

  it('blocks login once the per-email window is exceeded', async () => {
    // Two pipelines fire (email + IP); per-email comes back over the cap.
    runPipeline
      .mockResolvedValueOnce([
        [null, 6],
        [null, 1],
      ]) // email bucket
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ]); // ip bucket

    const result = await checkAuthMutationLimit('login', 'attacker@example.com', '1.2.3.4');

    expect(result.exceeded).toBe(true);
  });

  it('allows login while both per-email and per-IP windows are under cap', async () => {
    runPipeline
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ])
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ]);

    const result = await checkAuthMutationLimit('login', 'user@example.com', '1.2.3.4');

    expect(result.exceeded).toBe(false);
  });

  it('skips the IP bucket when no client IP is supplied', async () => {
    runPipeline.mockResolvedValueOnce([
      [null, 1],
      [null, 1],
    ]);

    const result = await checkAuthMutationLimit('login', 'user@example.com', null);

    expect(result.exceeded).toBe(false);
    // Only one pipeline ran (email) — the IP path was short-circuited.
    expect(multi).toHaveBeenCalledTimes(1);
  });

  it('blocks verify once the per-email attempt cap is exceeded', async () => {
    runPipeline.mockResolvedValueOnce([
      [null, 11],
      [null, 1],
    ]);

    const result = await checkAuthMutationLimit('verify', 'target@example.com', '1.2.3.4');

    expect(result.exceeded).toBe(true);
  });

  it('lowercases the email before bucketing so case variants share the limit', async () => {
    runPipeline.mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);

    await checkAuthMutationLimit('login', 'User@EXAMPLE.com', '1.2.3.4');

    const incrCalls = incr.mock.calls;
    const sawLowercased = incrCalls.some(args => String(args[0]).includes('user@example.com'));
    expect(sawLowercased).toBe(true);
  });
});
