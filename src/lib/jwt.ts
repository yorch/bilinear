/**
 * Client-side helpers for reading claims out of the JWT access token.
 *
 * Signature verification stays server-side: the cookie was already validated
 * by the server when it set it, so the client only needs to read the payload
 * to scope per-session features (sync cache, transaction queue) to the right
 * user/org. If the token is malformed, callers get `null` and can degrade
 * gracefully rather than crash.
 */

interface AccessTokenClaims {
  orgId?: string;
  userId?: string;
}

function decodeJwtPayload(token: string): AccessTokenClaims | null {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) {
      return null;
    }
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as AccessTokenClaims;
  } catch {
    return null;
  }
}

export function decodeTokenOrgId(token: string): string | null {
  return decodeJwtPayload(token)?.orgId ?? null;
}

export function decodeSessionClaims(token: string): { orgId: string; userId: string } | null {
  const payload = decodeJwtPayload(token);
  if (!payload?.orgId || !payload.userId) {
    return null;
  }
  return { orgId: payload.orgId, userId: payload.userId };
}
