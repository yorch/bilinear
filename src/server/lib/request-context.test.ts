import type { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { requestContext } from './logger';
import { bindRequestContext, withRequestContext } from './request-context';

// The handler never touches the request, so a bare object is enough.
const fakeReq = {} as NextRequest;
const okResponse = new Response('ok');

describe('withRequestContext', () => {
  it('runs the handler inside a context carrying requestId + route', async () => {
    let seen: Record<string, unknown> | undefined;
    const handler = withRequestContext('sync/delta', async () => {
      seen = requestContext.getStore();
      return okResponse;
    });

    const res = await handler(fakeReq);

    expect(res).toBe(okResponse);
    expect(seen?.route).toBe('sync/delta');
    expect(typeof seen?.requestId).toBe('string');
    expect((seen?.requestId as string).length).toBeGreaterThan(0);
  });

  it('preserves the context across an await inside the handler', async () => {
    let requestIdBefore: unknown;
    let requestIdAfter: unknown;
    const handler = withRequestContext('sync/bootstrap', async () => {
      requestIdBefore = requestContext.getStore()?.requestId;
      await Promise.resolve();
      requestIdAfter = requestContext.getStore()?.requestId;
      return okResponse;
    });

    await handler(fakeReq);

    expect(requestIdBefore).toBeDefined();
    expect(requestIdAfter).toBe(requestIdBefore);
  });

  it('gives each invocation a distinct requestId', async () => {
    const ids: unknown[] = [];
    const handler = withRequestContext('sync/delta', async () => {
      ids.push(requestContext.getStore()?.requestId);
      return okResponse;
    });

    await handler(fakeReq);
    await handler(fakeReq);

    expect(ids[0]).not.toBe(ids[1]);
  });

  it('does not leak context outside the handler scope', async () => {
    const handler = withRequestContext('sync/delta', async () => okResponse);
    await handler(fakeReq);
    expect(requestContext.getStore()).toBeUndefined();
  });
});

describe('bindRequestContext', () => {
  it('merges bindings into the active store, visible to later reads', async () => {
    let seen: Record<string, unknown> | undefined;
    const handler = withRequestContext('auth/saml/callback', async () => {
      bindRequestContext({ orgId: 'org-1' });
      bindRequestContext({ userId: 'user-1' });
      seen = requestContext.getStore();
      return okResponse;
    });

    await handler(fakeReq);

    expect(seen?.orgId).toBe('org-1');
    expect(seen?.userId).toBe('user-1');
    // The wrap-time fields are preserved alongside the bound ones.
    expect(seen?.route).toBe('auth/saml/callback');
    expect(seen?.requestId).toBeDefined();
  });

  it('is a no-op (does not throw) outside a request scope', () => {
    expect(() => bindRequestContext({ orgId: 'org-1' })).not.toThrow();
    expect(requestContext.getStore()).toBeUndefined();
  });
});
