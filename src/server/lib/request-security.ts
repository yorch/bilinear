import type { NextRequest, NextResponse } from 'next/server';
import { REFRESH_TOKEN_DAYS } from './jwt';

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

/**
 * Best-effort client IP. Only trusts `X-Forwarded-For` / `X-Real-IP` when
 * `TRUST_PROXY_HEADERS=1` (deploy only behind a proxy that strips
 * client-supplied forwarding headers); otherwise falls back to the socket
 * peer. Never trust the raw header by default — it is attacker-controlled.
 */
export function getClientIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY_HEADERS === '1') {
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
  const nextIp = (req as unknown as { ip?: string | null }).ip;
  return nextIp ?? null;
}

/**
 * Allow-list of Origins permitted to hit state-changing endpoints. Built from
 * `APP_URL` plus comma-separated `GRAPHQL_ALLOWED_ORIGINS`. An empty list
 * disables the check (e.g. tests, or same-origin requests with no Origin).
 */
export function getAllowedOrigins(): string[] {
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
