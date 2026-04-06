import { GraphQLError } from 'graphql';
import type { AccessTokenPayload } from '../lib/jwt';
import { verifyAccessToken } from '../lib/jwt';

export interface AuthContext {
  userId: string | null;
  orgId: string | null;
}

export async function extractAuthContext(
  authHeader: string | null,
  cookieToken: string | null,
): Promise<AuthContext> {
  const token = extractBearerToken(authHeader) ?? cookieToken ?? null;

  if (!token) {
    return { orgId: null, userId: null };
  }

  try {
    const payload: AccessTokenPayload = await verifyAccessToken(token);
    return { orgId: payload.orgId, userId: payload.userId };
  } catch {
    return { orgId: null, userId: null };
  }
}

export function requireAuth(
  ctx: AuthContext,
): asserts ctx is { userId: string; orgId: string } {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
