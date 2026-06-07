import crypto from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { PrismaClient } from '../../generated/prisma';
import type { AccessTokenPayload } from '../lib/jwt';
import { verifyAccessToken } from '../lib/jwt';

export interface AuthContext {
  orgId: string | null;
  userId: string | null;
}

export async function extractAuthContext(
  authHeader: string | null,
  cookieToken: string | null,
  prisma?: PrismaClient,
): Promise<AuthContext> {
  const token = extractBearerToken(authHeader) ?? cookieToken ?? null;

  if (!token) {
    return { orgId: null, userId: null };
  }

  try {
    const payload: AccessTokenPayload = await verifyAccessToken(token);
    return { orgId: payload.orgId, userId: payload.userId };
  } catch {
    // fall through to API key check
  }

  if (prisma && token.startsWith('bil_')) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const authToken = await prisma.authToken.findFirst({
      include: {
        user: {
          include: {
            orgMemberships: { orderBy: { createdAt: 'asc' as const }, take: 1 },
          },
        },
      },
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
        tokenHash,
        type: 'api_key',
      },
    });
    if (authToken) {
      const orgId = authToken.user.orgMemberships[0]?.organizationId ?? null;
      void prisma.authToken
        .update({
          data: { lastUsedAt: new Date() },
          where: { id: authToken.id },
        })
        .catch(() => {});
      return { orgId, userId: authToken.userId };
    }
  }

  return { orgId: null, userId: null };
}

export function requireAuth(ctx: AuthContext): asserts ctx is { userId: string; orgId: string } {
  if (!ctx.userId || !ctx.orgId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

/** Like requireAuth but only checks userId — for mutations before org exists (e.g. onboarding). */
export function requireUserId(ctx: AuthContext): asserts ctx is AuthContext & { userId: string } {
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

/**
 * Verify the caller is a member of `teamId` AND that the team belongs to
 * the caller's org. The orgId check is critical for multi-org accounts:
 * without it, a user who is a member of team T in org A can pass this
 * check while currently authenticated to org B and trigger team T's
 * mutations from B's context, breaking tenant isolation.
 */
export async function requireTeamMember(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
  orgId: string,
): Promise<void> {
  const membership = await prisma.teamMembership.findUnique({
    include: { team: { select: { organizationId: true } } },
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  if (!membership || membership.team.organizationId !== orgId) {
    throw new GraphQLError('Not a member of this team', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

export async function requireTeamOwner(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
  orgId: string,
): Promise<void> {
  const membership = await prisma.teamMembership.findUnique({
    include: { team: { select: { organizationId: true } } },
    where: {
      teamId_userId: { teamId, userId },
    },
  });

  if (!membership?.isOwner || membership.team.organizationId !== orgId) {
    throw new GraphQLError('Must be a team owner', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

/**
 * Returns the caller's role on `teamId` (admin | member | guest), or null if
 * they are not a team member. `team_member_roles` is the per-team role table
 * (separate from `team_memberships`, which only carries `isOwner`). Absence
 * of a role row defaults to `member`. A caller from a different org returns
 * null even if a `team_member_roles` row exists.
 */
const VALID_TEAM_ROLES = new Set<TeamRole>(['admin', 'member', 'guest']);
type TeamRole = 'admin' | 'member' | 'guest';

export async function getTeamRole(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
  orgId: string,
): Promise<TeamRole | null> {
  const membership = await prisma.teamMembership.findUnique({
    include: { team: { select: { organizationId: true } } },
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || membership.team.organizationId !== orgId) {
    return null;
  }
  const roleRow = await prisma.teamMemberRole.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  // Validate against the allowlist instead of blind-casting the VARCHAR.
  // An unknown value (typo, future role, bad backfill) should NOT silently
  // grant non-guest access — default to the safest interpretation 'member'
  // when no row exists, but a present-but-unrecognised value falls back to
  // 'guest' so a misconfigured role is least-privilege, not most.
  const raw = roleRow?.role;
  if (raw == null) {
    return 'member';
  }
  return VALID_TEAM_ROLES.has(raw as TeamRole) ? (raw as TeamRole) : 'guest';
}

/**
 * Team-member guard that ALSO rejects guests. Use for write paths and for
 * read paths whose data isn't pre-filtered to guest-visible issues.
 * Guests can still call `requireTeamMember` for the issues they own or
 * are assigned to — but they can't author state changes, create
 * sub-issues, etc.
 */
export async function requireTeamMemberNotGuest(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
  orgId: string,
): Promise<void> {
  const role = await getTeamRole(prisma, teamId, userId, orgId);
  if (role === null) {
    throw new GraphQLError('Not a member of this team', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
  if (role === 'guest') {
    throw new GraphQLError('Guests cannot perform this action', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
}

/**
 * Returns true if `userId` is a guest on `teamId`. Read paths use this to
 * apply the guest visibility filter (only issues the guest created or is
 * assigned to). Returns false for non-members so callers don't accidentally
 * widen access to outsiders.
 */
export async function isTeamGuest(
  prisma: PrismaClient,
  teamId: string,
  userId: string,
  orgId: string,
): Promise<boolean> {
  return (await getTeamRole(prisma, teamId, userId, orgId)) === 'guest';
}

/**
 * Issue-level write/access guard. Used by per-issue mutations
 * (issueUpdate, issueArchive, issueDelete, issueSnooze/Unsnooze,
 * reactions, …) to enforce: any team member can act, EXCEPT a guest can
 * only act on issues they created or are assigned to. Mirrors Linear's
 * "guests interact with their own work" rule.
 *
 * Caller has already verified the issue belongs to `orgId`. We re-call
 * `requireTeamMember` here so the helper is self-contained — passing a
 * raw issue from outside a tenant guard would otherwise let a caller
 * bypass team checks entirely.
 */
export async function requireIssueAccessNotGuestOrOwn(
  prisma: PrismaClient,
  issue: { teamId: string; creatorId: string | null; assigneeId: string | null },
  userId: string,
  orgId: string,
): Promise<void> {
  await requireTeamMember(prisma, issue.teamId, userId, orgId);
  if (await isTeamGuest(prisma, issue.teamId, userId, orgId)) {
    if (issue.creatorId !== userId && issue.assigneeId !== userId) {
      throw new GraphQLError('Guests can only modify issues they created or are assigned to', {
        extensions: { code: 'FORBIDDEN' },
      });
    }
  }
}

/**
 * Returns the set of team ids in `orgId` where `userId` is a guest. Used
 * by relation resolvers (Project.issues, Cycle.issues, Issue.children) to
 * narrow result sets so a guest only sees issues from their own teams or
 * issues they created/are assigned to in teams where they are a guest.
 * Returns an empty array when the user has no guest roles anywhere.
 */
export async function getGuestTeamIds(
  prisma: PrismaClient,
  userId: string,
  orgId: string,
): Promise<string[]> {
  const rows = await prisma.teamMemberRole.findMany({
    select: { teamId: true },
    where: {
      role: 'guest',
      team: { organizationId: orgId },
      userId,
    },
  });
  return rows.map(r => r.teamId);
}

function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
