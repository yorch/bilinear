import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const originalPhase = process.env.NEXT_PHASE;

  beforeEach(() => {
    get.mockReset();
    delete process.env.NEXT_PHASE;
  });

  afterEach(() => {
    // Vitest isolates per file, so nothing outside would notice today — but a
    // test that leaves the environment altered is one reordering away from
    // being the reason another test fails.
    if (originalPhase === undefined) {
      delete process.env.NEXT_PHASE;
    } else {
      process.env.NEXT_PHASE = originalPhase;
    }
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

  it('does not even attempt a lookup while building', async () => {
    // `next build` probes every route. Letting those reach the resolver worked
    // — the catch handled it — but each opened a connection that could not
    // succeed and logged a stack trace, burying the warnings a build is read
    // for. Keyed on the variable Next actually sets: an earlier version keyed
    // on DATABASE_URL being unset, which CI sets, so it never fired there.
    process.env.NEXT_PHASE = 'phase-production-build';
    await expect(getAppName()).resolves.toBe(APP_NAME);
    expect(get).not.toHaveBeenCalled();
  });
});
