import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/lib/jwt', () => ({
  REFRESH_TOKEN_DAYS: 30,
  verifyAccessToken: vi.fn(async () => ({ orgId: 'org-1', userId: 'user-1' })),
  verifyRefreshToken: vi.fn(async () => ({ userId: 'user-1' })),
}));
vi.mock('@/server/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ accent: null, locale: null })) } },
}));
vi.mock('@/server/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { DELETE, POST } from './route';

/**
 * A hand-built stand-in rather than `new NextRequest(...)`: on the pinned Node
 * 24 the real class keeps its internals in private fields, and the route only
 * touches `headers`, `cookies` and `json()`.
 */
function request(init: {
  body?: unknown;
  contentType?: string | null;
  origin?: string | null;
}): NextRequest {
  const headers = new Map<string, string>();
  if (init.origin) {
    headers.set('origin', init.origin);
  }
  if (init.contentType) {
    headers.set('content-type', init.contentType);
  }
  return {
    cookies: { get: () => undefined },
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => {
      if (init.body === undefined) {
        throw new SyntaxError('Unexpected end of JSON input');
      }
      if (typeof init.body === 'string') {
        return JSON.parse(init.body);
      }
      return init.body;
    },
  } as unknown as NextRequest;
}

const tokens = { accessToken: 'a.b.c', refreshToken: 'd.e.f' };

describe('POST /api/auth/session', () => {
  const savedAppUrl = process.env.APP_URL;
  beforeEach(() => {
    process.env.APP_URL = 'https://app.example.com';
  });
  afterEach(() => {
    if (savedAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = savedAppUrl;
    }
  });

  it('installs the session cookies for a same-origin JSON request', async () => {
    const res = await POST(
      request({ body: tokens, contentType: 'application/json', origin: 'https://app.example.com' }),
    );
    expect(res.status).toBe(200);
    const cookies = res.cookies.getAll().map(c => c.name);
    expect(cookies).toEqual(expect.arrayContaining(['access_token', 'refresh_token']));
  });

  it('refuses a cross-site Origin before touching the body (login CSRF)', async () => {
    const res = await POST(
      request({
        body: tokens,
        contentType: 'application/json',
        origin: 'https://evil.example.com',
      }),
    );
    expect(res.status).toBe(403);
    expect(res.cookies.getAll()).toEqual([]);
  });

  it('refuses a form-encoded body: a cross-site <form> cannot send application/json', async () => {
    // `enctype="text/plain"` is the classic way to post a JSON-shaped body
    // without a preflight; the content type is what gives it away.
    const res = await POST(
      request({ body: JSON.stringify(tokens), contentType: 'text/plain', origin: null }),
    );
    expect(res.status).toBe(415);
    expect(res.cookies.getAll()).toEqual([]);
  });

  it('rejects malformed JSON with 400 rather than throwing', async () => {
    const res = await POST(
      request({
        body: undefined,
        contentType: 'application/json',
        origin: 'https://app.example.com',
      }),
    );
    expect(res.status).toBe(400);
    const scalar = await POST(
      request({ body: 'null', contentType: 'application/json', origin: 'https://app.example.com' }),
    );
    expect(scalar.status).toBe(400);
  });
});

describe('DELETE /api/auth/session', () => {
  it('refuses a cross-site logout', async () => {
    process.env.APP_URL = 'https://app.example.com';
    const res = await DELETE(request({ origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
  });

  it('clears the cookies for a same-origin request', async () => {
    process.env.APP_URL = 'https://app.example.com';
    const res = await DELETE(request({ origin: 'https://app.example.com' }));
    expect(res.status).toBe(200);
    expect(res.cookies.get('access_token')?.value).toBe('');
  });
});
