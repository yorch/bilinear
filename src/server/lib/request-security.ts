import type { NextRequest, NextResponse } from 'next/server';
import { env } from './env';
import { REFRESH_TOKEN_DAYS } from './jwt';
import { childLogger } from './logger';

const log = childLogger({ module: 'request-security' });

/**
 * Shared request-security helpers used by the GraphQL route and the
 * cookie-rewriting admin/auth API routes. Centralised so the client-IP
 * proxy-trust gate, the CSRF Origin allow-list, and the session-cookie
 * security attributes have a single definition instead of being re-derived
 * (and drifting) per route.
 */

/** Access-token cookie lifetime (24h in seconds), matching the JWT expiry. */
export const ACCESS_TOKEN_MAX_AGE = 60 * 60 * 24;
/**
 * Refresh-token cookie lifetime (in seconds), derived from the single
 * `REFRESH_TOKEN_DAYS` source of truth in jwt.ts so the cookie's `maxAge`
 * can never drift from the JWT `exp` claim or the DB `AuthToken.expiresAt`.
 */
export const REFRESH_TOKEN_MAX_AGE = REFRESH_TOKEN_DAYS * 60 * 60 * 24;

/**
 * Write a session JWT into an httpOnly cookie with the app-wide security
 * attributes. The single source of truth for `httpOnly`/`sameSite`/`secure`
 * across every session-minting route — change the policy here, not per route.
 */
export function setSessionCookie(
  res: NextResponse,
  name: string,
  token: string,
  maxAge: number,
): void {
  res.cookies.set(name, token, {
    httpOnly: true,
    maxAge,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

let warnedProxyTrustUnset = false;

/**
 * Client IP, or null when it cannot be established safely.
 *
 * Next 16 removed `NextRequest.ip`, and a route handler has no access to the
 * socket. Next itself fills `x-forwarded-for` from the socket peer only when
 * the header is absent, so a client-sent value is indistinguishable from the
 * real one. The header is therefore trusted only with `TRUST_PROXY_HEADERS=1`
 * (deploy behind a proxy that overwrites it); otherwise the answer is null and
 * callers MUST still rate limit (use `rateLimitKeyIp`) rather than skip.
 */
export function getClientIp(req: NextRequest): string | null {
  if (env.TRUST_PROXY_HEADERS) {
    const xff = req.headers.get('x-forwarded-for');
    const first = xff?.split(',')[0]?.trim();
    if (first) {
      return first;
    }
    const realIp = req.headers.get('x-real-ip');
    if (realIp) {
      return realIp;
    }
  }
  // Set by a few hosting adapters (framework-provided, not a header); Next 16's
  // own NextRequest has no `ip`, so on a plain deploy this is undefined.
  const platformIp = (req as unknown as { ip?: string | null }).ip;
  if (platformIp) {
    return platformIp;
  }
  if (!warnedProxyTrustUnset && process.env.NODE_ENV === 'production') {
    warnedProxyTrustUnset = true;
    log.warn(
      'TRUST_PROXY_HEADERS is not set: client IPs are unavailable, so per-IP rate limits fall back to shared buckets and audit/impersonation records carry no IP. Set TRUST_PROXY_HEADERS=1 behind a proxy that overwrites X-Forwarded-For.',
    );
  }
  return null;
}

/** Bucket name used in place of an IP that cannot be established. */
export const UNKNOWN_IP_BUCKET = 'unknown-ip';

/**
 * Key component for per-IP rate limits. An unknown IP shares one bucket (with a
 * caller-chosen larger limit) so the limiter still bites instead of being skipped.
 */
export function rateLimitKeyIp(req: NextRequest): { ip: string; known: boolean } {
  const ip = getClientIp(req);
  return ip ? { ip, known: true } : { ip: UNKNOWN_IP_BUCKET, known: false };
}

/**
 * Allow-list of Origins permitted to hit state-changing endpoints. Built from
 * `APP_URL` plus comma-separated `GRAPHQL_ALLOWED_ORIGINS`. An empty list
 * disables the check (e.g. tests, or same-origin requests with no Origin).
 */
function getAllowedOrigins(): string[] {
  const origins: string[] = [];
  if (process.env.APP_URL) {
    origins.push(process.env.APP_URL.replace(/\/$/, ''));
  }
  if (process.env.GRAPHQL_ALLOWED_ORIGINS) {
    for (const o of process.env.GRAPHQL_ALLOWED_ORIGINS.split(',')) {
      const trimmed = o.trim().replace(/\/$/, '');
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }
  return origins;
}

/**
 * CSRF Origin decision on a bare Origin string. A missing Origin is allowed
 * (same-origin navigations omit it on some browsers); an empty allow-list
 * disables the check (tests); a present-but-unlisted Origin is rejected.
 * The transport-neutral primitive shared by the REST guard and the Apollo
 * plugin (which only has the header string, not a NextRequest).
 */
export function isOriginStringAllowed(origin: string | null): boolean {
  if (!origin) {
    return true;
  }
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(origin);
}

/**
 * CSRF guard for non-Apollo POST routes (which don't get Apollo's
 * csrfPrevention). Returns true when the request's Origin is allowed.
 */
export function isOriginAllowed(req: NextRequest): boolean {
  return isOriginStringAllowed(req.headers.get('origin'));
}

/**
 * Read a request body with a hard size cap, without trusting Content-Length.
 * Returns null as soon as the cap is exceeded (the rest of the upload is
 * cancelled, not buffered). A declared Content-Length over the cap is refused
 * before reading anything.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null;
  }
  if (!req.body) {
    return Buffer.alloc(0);
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
