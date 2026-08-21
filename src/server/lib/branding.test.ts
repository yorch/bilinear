import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '@/lib/app-config';

const get = vi.fn();
vi.mock('@/server/config', () => ({ config: { get: (...args: unknown[]) => get(...args) } }));

const { getAppName } = await import('./branding');

/**
 * `getAppName` is called from the root layout, page metadata, the PWA manifest
 * and every transactional email — i.e. from the earliest and least
 * interruptible points in a response. Its contract is therefore narrower than
 * "resolve the knob": it must **never** throw, because the name is the least
 * important thing on a page and a database blip must not be able to take the
 * page with it.
 */
describe('getAppName', () => {
  beforeEach(() => {
    get.mockReset();
    process.env.DATABASE_URL = 'postgresql://localhost/test';
  });

  it('returns the configured name', async () => {
    get.mockResolvedValue('Acme Tracker');
    await expect(getAppName()).resolves.toBe('Acme Tracker');
    expect(get).toHaveBeenCalledWith('branding.appName');
  });

  it('falls back to the build-time name when the lookup fails', async () => {
    // A Postgres blip during SSR. The page still renders; only the name degrades.
    get.mockRejectedValue(new Error('database is not reachable'));
    await expect(getAppName()).resolves.toBe(APP_NAME);
  });

  it('does not even attempt a lookup without a database url', async () => {
    // `next build` probes every route with no DATABASE_URL. Letting that reach
    // the resolver worked — the catch handled it — but logged a stack trace per
    // probe, which buries the warnings a build is read for.
    delete process.env.DATABASE_URL;
    await expect(getAppName()).resolves.toBe(APP_NAME);
    expect(get).not.toHaveBeenCalled();
  });
});
