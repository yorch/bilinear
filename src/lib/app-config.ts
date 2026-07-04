/**
 * Centralized, configurable app-level branding.
 *
 * `APP_NAME` is the single source of truth for the product's display name.
 * Override it per-deployment via the `NEXT_PUBLIC_APP_NAME` env var (inlined
 * into both the client bundle and server runtime at build time); it defaults
 * to "Bilinear". Import this everywhere the brand name is shown instead of
 * hardcoding a string.
 */
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'Bilinear';
