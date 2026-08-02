import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_PATH, SERVICE_WORKER_PATH } from './pwa';

/**
 * Behavioural guard over `public/sw.js`.
 *
 * A service worker sits in front of every navigation the app makes and is the
 * hardest thing in the codebase to roll back: a bad one is installed in real
 * browsers and keeps running there after the deploy that fixed it. It is also
 * invisible to every other gate — it lives in `public/`, so Biome doesn't lint
 * it, TypeScript doesn't see it, and the build just copies it.
 *
 * So it is executed here, in a stand-in for the worker global scope, and its
 * handlers are driven with synthetic events. The properties asserted are the
 * ones whose violation would be a real incident rather than a cosmetic bug:
 * that it never caches a response (every HTML response is per-user and
 * per-workspace), that it leaves everything except navigations alone (the
 * GraphQL endpoint, /api/sync and uploads must never be intercepted), and
 * that a server error is not disguised as being offline.
 */

const ORIGIN = 'https://app.test';

const SW_SOURCE = readFileSync(join(process.cwd(), 'public', SERVICE_WORKER_PATH), 'utf8');

interface Harness {
  cache: { entries: Map<string, Response>; put: ReturnType<typeof vi.fn> };
  deletedCaches: string[];
  dispatch: (type: string, event: Record<string, unknown>) => void;
  fetchMock: ReturnType<typeof vi.fn>;
  openedCaches: string[];
  waits: Promise<unknown>[];
}

function loadWorker(existingCacheKeys: string[] = []): Harness {
  const listeners = new Map<string, (event: unknown) => void>();
  const waits: Promise<unknown>[] = [];
  const entries = new Map<string, Response>();
  const openedCaches: string[] = [];
  const deletedCaches: string[] = [];

  const put = vi.fn();
  const cache = {
    add: vi.fn(async (request: Request) => {
      entries.set(new URL(request.url).pathname, new Response('offline page'));
    }),
    entries,
    match: async (key: string) => entries.get(key),
    put,
  };

  const caches = {
    delete: vi.fn(async (key: string) => {
      deletedCaches.push(key);
      return true;
    }),
    keys: async () => existingCacheKeys,
    open: vi.fn(async (name: string) => {
      openedCaches.push(name);
      return cache;
    }),
  };

  const self = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
  };

  const fetchMock = vi.fn();

  /**
   * A worker resolves a relative URL against its own scope; Node's `Request`
   * has no scope and rejects one outright, so this supplies the origin the
   * rest of the test uses.
   */
  class ScopedRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, ORIGIN) : input, init);
    }
  }

  // The worker's globals are passed in as parameters, which shadows the real
  // ones for the duration of the source — no globalThis patching, and no way
  // for the worker to reach Node's fetch by accident.
  new Function('self', 'caches', 'fetch', 'Request', SW_SOURCE)(
    self,
    caches,
    fetchMock,
    ScopedRequest,
  );

  return {
    cache: { entries, put },
    deletedCaches,
    dispatch: (type, event) => {
      const handler = listeners.get(type);
      if (!handler) {
        throw new Error(`service worker registered no '${type}' listener`);
      }
      handler({ waitUntil: (promise: Promise<unknown>) => waits.push(promise), ...event });
    },
    fetchMock,
    openedCaches,
    waits,
  };
}

/** Drives the fetch handler and returns what it responded with, if anything. */
async function handleFetch(
  harness: Harness,
  request: Request,
): Promise<Response | 'not-intercepted'> {
  let responded: Promise<Response> | undefined;
  harness.dispatch('fetch', {
    request,
    respondWith: (value: Promise<Response>) => {
      responded = value;
    },
  });
  return responded ? await responded : 'not-intercepted';
}

/**
 * A `Request` with a chosen `mode`.
 *
 * `mode` is read-only, and the constructor rejects `mode: 'navigate'` outright
 * (the spec reserves it for requests the browser itself creates) — so the only
 * way to hand the worker a navigation is to wrap a real request.
 *
 * It has to be a **Proxy**, not `Object.create(request, …)`. An object whose
 * *prototype* is a Request is not a Request: every accessor on
 * `Request.prototype` reads a private class field, which throws for any
 * receiver that isn't a genuine instance. Node 22 happened to tolerate it
 * (undici kept that state off-instance then); Node 24 — the version this repo
 * pins — throws `Cannot read private member #state`. Reflect.get without an
 * explicit receiver keeps `this` bound to the real request, so the accessors
 * see the instance they belong to.
 */
function requestWith(url: string, mode: string, method = 'GET'): Request {
  const request = new Request(url, { method });
  return new Proxy(request, {
    // No `receiver` parameter, deliberately: forwarding the proxy as the
    // receiver is exactly what would break the private-field accessors.
    get(target, property) {
      if (property === 'mode') {
        return mode;
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('service worker', () => {
  it('is served from the path the registrar registers', () => {
    expect(existsSync(join(process.cwd(), 'public', SERVICE_WORKER_PATH))).toBe(true);
    expect(existsSync(join(process.cwd(), 'public', OFFLINE_PATH))).toBe(true);
    // The worker hardcodes the offline URL (it can't import from src/), so the
    // two have to be checked against each other.
    expect(SW_SOURCE).toContain(`'${OFFLINE_PATH}'`);
  });

  describe('install and activate', () => {
    it('precaches the offline page', async () => {
      const harness = loadWorker();
      harness.dispatch('install', {});
      await Promise.all(harness.waits);

      expect([...harness.cache.entries.keys()]).toEqual([OFFLINE_PATH]);
    });

    it('drops caches from earlier worker versions', async () => {
      const harness = loadWorker(['bilinear-offline-v0', 'some-other-cache']);
      harness.dispatch('activate', {});
      await Promise.all(harness.waits);

      expect(harness.deletedCaches).toEqual(['bilinear-offline-v0', 'some-other-cache']);
      // The current cache is whichever one the worker opens; it must survive.
      const harnessAfterInstall = loadWorker();
      harnessAfterInstall.dispatch('install', {});
      await Promise.all(harnessAfterInstall.waits);
      expect(harness.deletedCaches).not.toContain(harnessAfterInstall.openedCaches[0]);
    });
  });

  describe('fetch', () => {
    let harness: Harness;

    beforeEach(async () => {
      harness = loadWorker();
      harness.dispatch('install', {});
      await Promise.all(harness.waits);
      harness.fetchMock.mockReset();
    });

    it.each([
      ['the GraphQL endpoint', `${ORIGIN}/api/graphql`, 'cors'],
      ['delta sync', `${ORIGIN}/api/sync/delta`, 'cors'],
      ['an upload', `${ORIGIN}/api/upload`, 'cors'],
      // WS_PUBLIC_URL / YJS_PUBLIC_URL take a same-origin path form behind a
      // TLS proxy (`/ws`, `/collab`), which puts the realtime endpoints inside
      // the worker's scope. The upgrade itself is never dispatched to a fetch
      // handler, but the ticket request in front of it is an ordinary fetch.
      ['the WS ticket', `${ORIGIN}/api/auth/ws-ticket`, 'cors'],
      ['the WS endpoint', `${ORIGIN}/ws`, 'cors'],
      ['the collab endpoint', `${ORIGIN}/collab`, 'cors'],
      ['a static chunk', `${ORIGIN}/_next/static/chunks/main-abc123.js`, 'no-cors'],
      ['an icon', `${ORIGIN}/icons/icon-192.png`, 'no-cors'],
    ])('does not intercept %s', async (_label, url, mode) => {
      expect(await handleFetch(harness, requestWith(url, mode))).toBe('not-intercepted');
      expect(harness.fetchMock).not.toHaveBeenCalled();
    });

    it('does not intercept a non-GET navigation', async () => {
      const request = requestWith(`${ORIGIN}/login`, 'navigate', 'POST');
      expect(await handleFetch(harness, request)).toBe('not-intercepted');
    });

    it('passes a navigation straight through, caching nothing', async () => {
      const fromNetwork = new Response('<html>workspace</html>');
      harness.fetchMock.mockResolvedValue(fromNetwork);

      const response = await handleFetch(harness, requestWith(`${ORIGIN}/acme`, 'navigate'));

      expect(response).toBe(fromNetwork);
      // The whole point: a rendered page carries the viewer's org, teams and
      // role, so it must never reach a cache other clients could read.
      expect(harness.cache.put).not.toHaveBeenCalled();
    });

    it('serves the offline page when the network is unreachable', async () => {
      harness.fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const response = await handleFetch(harness, requestWith(`${ORIGIN}/acme`, 'navigate'));

      expect(response).not.toBe('not-intercepted');
      expect(await (response as Response).text()).toBe('offline page');
    });

    it('passes a server error through instead of claiming to be offline', async () => {
      const serverError = new Response('boom', { status: 500 });
      harness.fetchMock.mockResolvedValue(serverError);

      const response = await handleFetch(harness, requestWith(`${ORIGIN}/acme`, 'navigate'));

      expect(response).toBe(serverError);
    });
  });
});
