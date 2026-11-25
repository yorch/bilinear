import { safeRelativePath } from '@/lib/safe-path';

/**
 * Request header carrying the pathname + search of the page being rendered.
 * Set only by `src/proxy.ts`; a layout cannot see the URL any other way.
 */
export const REQUEST_PATH_HEADER = 'x-bilinear-path';

/**
 * Where a signed-out visitor to a protected layout should be sent: the login
 * page, remembering the full path they asked for. `fallback` is used when the
 * header is missing (proxy not run, e.g. a unit test) or fails validation —
 * the header is client-forgeable until the proxy overwrites it, so it goes
 * through `safeRelativePath` like any other `next` value.
 */
export function loginRedirectPath(
  requestPath: string | null | undefined,
  fallback: string,
  scope?: string,
) {
  const safe = safeRelativePath(requestPath);
  // Defence in depth: the path must live under the tree being rendered, so a
  // forged header cannot point the post-login redirect at another tree.
  const next = safe && (!scope || isUnder(safe, scope)) ? safe : fallback;
  return `/login?next=${encodeURIComponent(next)}`;
}

/** True when `path` is `scope` itself or below it (segment-wise, query ignored). */
function isUnder(path: string, scope: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  return pathname === scope || pathname.startsWith(`${scope}/`);
}

/**
 * `requestPath` with its first segment (the workspace url key) replaced —
 * where a link to a renamed workspace should land. Null when the path is
 * missing or unsafe, so the caller falls back to the new workspace root.
 */
export function withWorkspaceKey(
  requestPath: string | null | undefined,
  newKey: string,
): string | null {
  const safe = safeRelativePath(requestPath);
  if (!safe) {
    return null;
  }
  const rest = safe.replace(/^\/[^/?#]*/, '');
  return `/${newKey}${rest}`;
}
