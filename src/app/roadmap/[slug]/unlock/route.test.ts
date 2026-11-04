import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashRoadmapPassword, isRoadmapUnlockTokenValid } from '@/server/services/roadmap.service';

const findUnique = vi.fn();
const checkFixedWindow = vi.fn();

vi.mock('@/server/lib/prisma', () => ({
  prisma: { publicRoadmap: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));
vi.mock('@/server/middleware/rate-limit', () => ({
  checkFixedWindow: (...a: unknown[]) => checkFixedWindow(...a),
}));

import { POST } from './route';

const SLUG = 'acme';

function post(password: string, slug = SLUG, headers: Record<string, string> = {}) {
  const body = new URLSearchParams({ password });
  const req = new NextRequest(`http://localhost:3000/roadmap/${slug}/unlock`, {
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    method: 'POST',
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

describe('POST /roadmap/[slug]/unlock', () => {
  let passwordHash: string;
  beforeEach(async () => {
    vi.clearAllMocks();
    passwordHash = await hashRoadmapPassword('hunter2');
    findUnique.mockResolvedValue({ enabled: true, id: 'rm1', passwordHash, slug: SLUG });
    checkFixedWindow.mockResolvedValue({ count: 1, exceeded: false });
  });

  it('sets the unlock cookie and redirects relatively on the correct password', async () => {
    const res = await post('hunter2', SLUG, {
      host: 'issues.example.com',
      'x-forwarded-proto': 'https',
    });
    expect(res.status).toBe(303);
    // Relative: the browser keeps its own origin, so the cookie reaches the page.
    expect(res.headers.get('location')).toBe('/roadmap/acme');
    const cookie = res.cookies.get('roadmap_unlock_acme');
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe('/roadmap/acme');
    expect(isRoadmapUnlockTokenValid(cookie?.value, SLUG, passwordHash)).toBe(true);
  });

  it('sets no cookie and flags an error on a wrong password', async () => {
    const res = await post('nope');
    expect(res.headers.get('location')).toBe('/roadmap/acme?error=1');
    expect(res.cookies.get('roadmap_unlock_acme')).toBeUndefined();
  });

  it('rejects when rate limited, without verifying or setting a cookie', async () => {
    checkFixedWindow.mockResolvedValue({ count: 99, exceeded: true });
    const res = await post('hunter2');
    expect(res.headers.get('location')).toBe('/roadmap/acme?error=rate');
    expect(res.cookies.get('roadmap_unlock_acme')).toBeUndefined();
  });

  it('does not use a shared per-IP bucket when the client IP is unknown', async () => {
    await post('hunter2');
    const keys = checkFixedWindow.mock.calls.map(c => String(c[0]));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.some(k => k.includes(':ip:'))).toBe(false);
  });

  it('fails closed on the limiter (requests failClosed=true)', async () => {
    await post('hunter2');
    expect(checkFixedWindow).toHaveBeenCalled();
    for (const call of checkFixedWindow.mock.calls) {
      expect(call[3]).toBe(true);
    }
  });

  it('redirects away for an invalid slug without touching the database', async () => {
    const res = await post('hunter2', 'bad slug;x');
    expect(res.headers.get('location')).toBe('/');
    expect(findUnique).not.toHaveBeenCalled();
    expect(res.cookies.get('roadmap_unlock_bad slug;x')).toBeUndefined();
  });

  it('rejects an over-long password before hashing it', async () => {
    const res = await post('x'.repeat(257));
    expect(res.headers.get('location')).toBe('/roadmap/acme?error=1');
    expect(res.cookies.get('roadmap_unlock_acme')).toBeUndefined();
    expect(checkFixedWindow).not.toHaveBeenCalled();
  });

  it('does nothing for a disabled or password-less roadmap', async () => {
    findUnique.mockResolvedValue({ enabled: false, id: 'rm1', passwordHash, slug: SLUG });
    const res = await post('hunter2');
    expect(res.headers.get('location')).toBe('/roadmap/acme');
    expect(res.cookies.get('roadmap_unlock_acme')).toBeUndefined();
  });
});
