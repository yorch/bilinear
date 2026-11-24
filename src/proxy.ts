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
  // Only the two guarded trees' document requests matter. Exclude API routes
  // (`api/` or exactly `api` — NOT a prefix match, or a workspace called
  // "apiary" loses its deep link), Next internals and static assets (sw.js,
  // offline.html, manifest, icons, fonts, source maps).
  // The extension list is an allow-list, not "anything with a dot": a dotted
  // segment is legitimate in a deep link (`/demo/project/v1.2`). It must stay a
  // plain string literal — Next reads `config` statically.
  matcher: [
    '/((?!api/|api$|_next/|[^?]*\\.(?:avif|css|eot|gif|html|ico|jpe?g|js|json|map|mjs|mp4|otf|pdf|png|svg|ttf|txt|wasm|webm|webmanifest|webp|woff2?|xml)$).*)',
  ],
};
