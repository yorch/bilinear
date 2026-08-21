/**
 * The product's display name, in the one form that is available everywhere.
 *
 * This is the **fallback**, not the source of truth. `branding.appName` in the
 * config registry is, and it is resolved per request by the root layout
 * (`BrandingProvider` for React, `getAppName()` for metadata, the PWA manifest
 * and transactional email). Renaming the product is a change at
 * `/admin/config`, with no rebuild.
 *
 * `APP_NAME` remains for the two cases a resolved value cannot reach:
 *
 * - the registry's own declared default, and
 * - any surface that must render before, or despite, a database read — the
 *   fallback `getAppName()` returns if the query fails.
 *
 * `NEXT_PUBLIC_APP_NAME` is still honoured, both here (inlined by `next build`)
 * and as the knob's `default`-mode environment layer, so a deployment that sets
 * it keeps the behaviour it had before the knob existed.
 */
export const DEFAULT_APP_NAME = 'Bilinear';

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? DEFAULT_APP_NAME;
