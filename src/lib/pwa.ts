/**
 * Progressive-web-app constants shared by the manifest route and the root
 * layout's viewport metadata.
 *
 * ## Why these colours are literals
 *
 * Everything visual in this app resolves through a CSS custom property, and
 * `yarn lint:tokens` exists to keep it that way. These two values are the
 * deliberate exception: a web app manifest is JSON handed to the operating
 * system, and the `<meta name="theme-color">` value is read by the browser
 * before any stylesheet is parsed — neither can dereference a `var()`. So the
 * colour has to be spelled out, in a colour space every manifest parser
 * understands.
 *
 * They are not free-floating, though: `src/app/manifest.test.ts` resolves
 * `--background` out of `globals.css` for both themes, converts it to sRGB and
 * asserts these match. Change the neutral ramp and that test tells you to
 * change these too, which is the property the token guard would otherwise
 * have provided.
 *
 * The hue is the default accent's (`--accent-h: 285`). The icon and the
 * splash screen are baked into the installed app at install time, so they
 * cannot follow a per-user accent the way the running UI does.
 */

/** `--background` under the default accent, light theme — `oklch(0.988 0.004 285)`. */
export const PWA_BACKGROUND_LIGHT = 'rgb(251, 251, 254)';

/** `--background` under the default accent, dark theme — `oklch(0.148 0.014 285)`. */
export const PWA_BACKGROUND_DARK = 'rgb(10, 10, 16)';

/**
 * Path of the service worker, registered at the root scope so it covers every
 * route (see `public/sw.js`).
 */
export const SERVICE_WORKER_PATH = '/sw.js';

/** Offline fallback served for navigations that can't reach the network. */
export const OFFLINE_PATH = '/offline.html';
