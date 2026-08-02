'use client';

import { useEffect } from 'react';
import { SERVICE_WORKER_PATH } from '@/lib/pwa';

/**
 * Registers `public/sw.js`, which is what turns the manifest into an
 * *installable* app — Chrome requires a service worker with a fetch handler
 * before it will offer installation.
 *
 * Renders nothing; mounted once in the root layout so the registration covers
 * the auth routes too (a visitor can install from the sign-in page).
 *
 * Registration is production-only, and development actively *unregisters*.
 * A worker installed by a production build (or a `next start` on the same
 * localhost origin) outlives the page that registered it and would go on
 * intercepting navigations against the dev server, where it answers with a
 * stale offline page instead of letting the request through. Since the worker
 * caches nothing but that page, dropping it in dev costs nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      });
      return;
    }

    // Deliberately unawaited and error-swallowed: registration failing (a
    // non-secure origin, a browser that blocks workers, an offline first
    // visit) must never surface to the user or break the page — the app works
    // exactly the same without it, minus installability.
    navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => {});
  }, []);

  return null;
}
