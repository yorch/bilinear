/**
 * Workspace URL keys — the `/<key>` first path segment.
 *
 * Shared by the onboarding form and the server's `OrganizationService` so the
 * client's hint and the server's verdict can never disagree.
 */

/**
 * First path segments that already belong to a top-level route (or a public
 * asset). A workspace created with one of these would be unreachable — the
 * static route always wins over `/[workspace]`.
 */
export const RESERVED_URL_KEYS: readonly string[] = [
  'admin',
  'api',
  'auth',
  'design',
  'health',
  'icons',
  'invite',
  'login',
  'manifest',
  'offline',
  'onboarding',
  'roadmap',
  'scim',
  'uploads',
  'verify',
];

export const MAX_URL_KEY_LENGTH = 63;

export function isReservedUrlKey(key: string): boolean {
  return RESERVED_URL_KEYS.includes(key.toLowerCase());
}

/**
 * Per-keystroke sanitiser. Unlike `finalizeUrlKey` it keeps a trailing hyphen,
 * otherwise typing the `-` in `acme-corp` is erased before the next letter
 * arrives and the key can only ever be `acmecorp`.
 */
export function sanitizeUrlKeyInput(value: string): string {
  return (
    value
      // Decompose accents first so "Ünïcode" becomes "unicode" rather than
      // losing the letters the [^a-z0-9] pass would otherwise strip whole.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, MAX_URL_KEY_LENGTH)
  );
}

/** Trim edge hyphens; run on blur, on submit and when deriving from a name. */
export function finalizeUrlKey(value: string): string {
  return sanitizeUrlKeyInput(value).replace(/-+$/, '');
}
