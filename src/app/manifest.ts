import type { MetadataRoute } from 'next';
import { getServerTranslations } from '@/lib/i18n/server';
import { PWA_BACKGROUND_LIGHT } from '@/lib/pwa';
import { getAppName } from '@/server/lib/branding';

/**
 * Web app manifest — what makes the app installable from Chrome's omnibox
 * (and every other Chromium browser, plus Safari's "Add to Dock").
 *
 * Next serves this at `/manifest.webmanifest` and injects the `<link
 * rel="manifest">` into every page, so nothing in the layout references it.
 *
 * Chrome's installability criteria, and where each is met:
 *   - served over HTTPS (or localhost)          — deployment concern
 *   - `name`/`short_name`, `start_url`, `display`, and 192px + 512px icons
 *                                               — below
 *   - a service worker with a fetch handler     — `public/sw.js`, registered
 *                                                 by `ServiceWorkerRegistrar`
 *
 * The manifest is localised the same way `generateMetadata` is. Note the
 * browser fetches it without credentials unless the link carries
 * `crossorigin="use-credentials"`, so the `locale` cookie usually isn't sent
 * and `getServerLocale` falls through to `Accept-Language` — which is the
 * right answer for a value the OS caches at install time anyway.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);

  return {
    background_color: PWA_BACKGROUND_LIGHT,
    description: t('meta.description'),
    display: 'standalone',
    // The app's own chrome (sidebar, command palette, breadcrumbs) is a full
    // replacement for the browser's, so it takes the whole window; a browser
    // that can't do `standalone` falls back down this list rather than to a
    // plain tab.
    display_override: ['standalone', 'minimal-ui'],
    icons: [
      { purpose: 'any', sizes: '192x192', src: '/icons/icon-192.png', type: 'image/png' },
      { purpose: 'any', sizes: '512x512', src: '/icons/icon-512.png', type: 'image/png' },
      // Kept separate from the `any` icons on purpose: a maskable icon is
      // full-bleed and may be cropped to any shape inside its 80% safe zone,
      // so an icon declared as both is either padded oddly in the launcher or
      // clipped in the task switcher.
      {
        purpose: 'maskable',
        sizes: '512x512',
        src: '/icons/icon-maskable-512.png',
        type: 'image/png',
      },
    ],
    // A stable identity for the installed app, independent of `start_url` —
    // without it the browser derives the id from `start_url`, and changing
    // that later would register as a different app rather than an update.
    id: '/',
    name: appName,
    orientation: 'any',
    scope: '/',
    short_name: appName,
    // Not a workspace path: which workspace a session can enter is decided
    // server-side (and can change between launches), so the root route's
    // redirect is the only correct entry point.
    start_url: '/',
    theme_color: PWA_BACKGROUND_LIGHT,
  };
}
