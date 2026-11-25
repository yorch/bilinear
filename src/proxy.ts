import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { REQUEST_PATH_HEADER } from '@/lib/deep-link';

/**
 * The one thing this proxy does: forward the request's pathname + search as a
 * request header so a server layout can build a full-path `?next=` when it
 * redirects a signed-out visitor to /login (layouts cannot read the URL).
 *
 * It deliberately contains NO auth logic — session checks stay per page (see
 * PATTERNS.md §8). The header is always overwritten, so a client cannot
 * supply its own; consumers still validate with `safeRelativePath`.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // The proxy must run for EVERY page request, including ones whose path ends
  // in a static-looking extension (`/demo/issue/ABC-1.png` is still a document
  // request the workspace layout renders). Skipping those let a client-sent
  // `x-bilinear-path` reach the layout un-overwritten (and the header is not
  // in Vary, so a cache could keep the poisoned redirect). Only API routes
  // (`api/` or exactly `api` — NOT a prefix match, or a workspace called
  // "apiary" loses its deep link) and Next internals are excluded; real static
  // files pass through harmlessly (the proxy just sets a request header). It
  // must stay a plain string literal — Next reads `config` statically.
  matcher: ['/((?!api/|api$|_next/).*)'],
};
