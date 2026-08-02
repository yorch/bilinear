/**
 * Bilinear service worker.
 *
 * Two jobs, and deliberately only two:
 *
 *   1. Exist, with a `fetch` handler. Chrome will not offer to install a web
 *      app without one — it is part of the installability criteria alongside
 *      the manifest and its icons.
 *   2. Answer a navigation that can't reach the network with a real page
 *      instead of the browser's error screen.
 *
 * ## What it deliberately does NOT do
 *
 * It does not precache the app shell. Every HTML response here is rendered
 * per user and per workspace — it carries the viewer's org, their teams, their
 * role — so a cached copy is both a staleness problem and, on a shared
 * machine, a disclosure one. The app's offline story lives a layer up anyway:
 * the workspace is mirrored into IndexedDB (Dexie) and writes queue in
 * `TransactionQueue`, so what an offline session needs is the *shell* to boot,
 * not any particular cached response. Caching that shell safely needs a
 * user-independent shell route to cache, which does not exist today.
 *
 * It does not cache static assets either. `/_next/static/*` is content-hashed
 * and already served `immutable` with a one-year max-age, so an SW cache in
 * front of the HTTP cache would buy nothing and add a second, unbounded copy
 * that only a version bump here ever evicts.
 *
 * So: nothing but the offline page is stored, which is what keeps this file
 * free of cache-invalidation questions.
 *
 * Bump CACHE_VERSION whenever `offline.html` changes — the activate handler
 * drops every cache that isn't the current one.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `bilinear-offline-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // `cache: 'reload'` bypasses the HTTP cache so an install always stores
      // the offline page this worker version shipped with.
      .then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      // Nothing user-visible is cached, so there is no reason to make the new
      // worker wait for every old tab to close before taking over.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Only navigations are intercepted. Everything else — the GraphQL endpoint,
  // /api/sync, uploads, the WebSocket handshake, static assets — goes straight
  // to the network, untouched and uncached.
  if (request.mode !== 'navigate' || request.method !== 'GET') {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // Network-first, and network-only on success: the response is never
        // written to a cache (see the note above).
        return await fetch(request);
      } catch {
        // `fetch` rejects only when the network itself is unreachable — a 4xx
        // or 5xx from the server resolves normally and is passed through, so
        // a real error page is never replaced by the offline one.
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_URL);
        return (
          offline ??
          new Response('Offline', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            status: 503,
          })
        );
      }
    })(),
  );
});
