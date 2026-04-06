import { GraphQLError } from 'graphql';
import type { PrismaClient } from '../../generated/prisma';
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

export async function requireOrgRole(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  roles: string[],
): Promise<void> {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: orgId, userId },
    },
  });

  if (!membership || !roles.includes(membership.role)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

export async function requireTeamMember(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await prisma.teamMembership.findUnique({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  if (!membership) {
    throw new GraphQLError('Not a member of this team', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

export async function requireTeamOwner(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await prisma.teamMembership.findUnique({
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  if (!membership?.isOwner) {
    throw new GraphQLError('Must be a team owner', {
      extensions: { code: 'FORBIDDEN' },
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
