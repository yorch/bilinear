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
export function loginRedirectPath(requestPath: string | null | undefined, fallback: string) {
  const next = safeRelativePath(requestPath) ?? fallback;
  return `/login?next=${encodeURIComponent(next)}`;
}
