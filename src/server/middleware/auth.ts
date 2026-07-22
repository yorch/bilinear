import crypto from 'node:crypto';
import { GraphQLError } from 'graphql';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { PrismaClient } from '../../generated/prisma';
import type { AccessTokenPayload } from '../lib/jwt';
import { verifyAccessToken } from '../lib/jwt';

export interface AuthContext {
  /**
   * When the request was authenticated with an API key, the key's permission
   * scopes (e.g. `['read']`). `null` for session/JWT auth (full access) and
   * for unauthenticated requests. The GraphQL route rejects mutations when
   * this is non-null and lacks `write`. An empty array means a legacy key
   * with full access (see auth.service `apiScopesAllowWrite`). Optional so
   * callers constructing a bare `{ orgId, userId }` (tests, narrowing
   * predicates) stay valid — absent is treated as `null` (full access).
   */
  apiKeyScopes?: string[] | null;
  /**
   * Present only when the session is a platform admin impersonating another
   * user: the impersonating admin's id. `userId`/`orgId` are the *target's*.
   * Resolvers use this to (a) render the impersonation banner and (b) refuse
   * to let an impersonated session wield platform-admin powers.
   */
  impersonatorId?: string | null;
  orgId: string | null;
  userId: string | null;
}

const EMPTY_CONTEXT: AuthContext = {
  apiKeyScopes: null,
  impersonatorId: null,
  orgId: null,
  userId: null,
};

export async function extractAuthContext(
  authHeader: string | null,
  cookieToken: string | null,
  prisma?: PrismaClient,
): Promise<AuthContext> {
  const token = extractBearerToken(authHeader) ?? cookieToken ?? null;

  if (!token) {
    return { ...EMPTY_CONTEXT };
  }

  let resolved: AuthContext | null = null;

  try {
    const payload: AccessTokenPayload = await verifyAccessToken(token);
    resolved = {
      apiKeyScopes: null,
      impersonatorId: payload.impersonatorId ?? null,
      orgId: payload.orgId,
      userId: payload.userId,
    };
  } catch {
    // fall through to API key check
  }

  if (!resolved && prisma && token.startsWith('bil_')) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const authToken = await prisma.authToken.findFirst({
      select: {
        id: true,
        scopes: true,
        user: {
          select: {
            orgMemberships: {
              orderBy: { createdAt: 'asc' as const },
              select: { organizationId: true },
              take: 1,
            },
          },
        },
        userId: true,
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
      resolved = {
        apiKeyScopes: authToken.scopes,
        impersonatorId: null,
        orgId,
        userId: authToken.userId,
      };
    }
  }

  if (!resolved) {
    return { ...EMPTY_CONTEXT };
  }

  // Suspension enforcement (needs DB — skipped in unit tests that pass no
  // prisma). A globally-suspended user (active=false) is fully logged out; a
  // suspended/archived org drops only `orgId` so a platform admin whose own
  // org is suspended can still reach the /admin console (which needs userId
  // only) while being locked out of the workspace.
  if (prisma && resolved.userId) {
    // Run the user + org lookups concurrently — they're independent PK reads
    // and this is the app's hottest path (every authenticated request).
    const [user, org] = await Promise.all([
      prisma.user.findUnique({
        select: { active: true },
        where: { id: resolved.userId },
      }),
      resolved.orgId
        ? prisma.organization.findUnique({
            select: { archivedAt: true, suspendedAt: true },
            where: { id: resolved.orgId },
          })
        : Promise.resolve(null),
    ]);
    if (!user?.active) {
      return { ...EMPTY_CONTEXT };
    }
    if (org && (org.suspendedAt || org.archivedAt)) {
      resolved = { ...resolved, orgId: null };
    }
  }

  return resolved;
}

export interface RequireAuthContextOptions {
  /**
   * Also read a Bearer token from the `Authorization` header (in addition
   * to the `access_token` cookie). Default `true`. Routes that are only
   * ever called from the authenticated browser session (`ws-ticket`,
   * `integrations/github`) pass `false` to preserve their cookie-only
   * behavior.
   */
  allowHeader?: boolean;
  /** Message used in the 401 JSON body. Default `'Unauthorized'`. */
  unauthorizedMessage?: string;
}

/**
 * Shared "read the request's auth, 401 if missing" prologue used by every
 * Next.js route handler that authenticates outside GraphQL (bootstrap,
 * delta, upload, uploads/[...path], ws-ticket, integrations/github). Reads
 * the `access_token` cookie (and, unless `allowHeader` is `false`, the
 * `Authorization` header) and resolves it via `extractAuthContext` — which
 * re-checks user/org suspension against the DB on every call, so a
 * deactivated user or a suspended/archived org loses access immediately
 * rather than for the rest of the JWT's lifetime.
 *
 * Returns a discriminated result: `{ response }` when auth is missing (the
 * caller should return it as-is — same 401 shape each route used before
 * this helper existed), or `{ ctx }` on success. `requireUserId` (default
 * `true`) controls whether `ctx.userId` must also be present — pass
 * `false` for routes that only need `orgId` (e.g. `uploads/[...path]`),
 * since a caller whose org got suspended keeps a non-null `userId` while
 * `orgId` is cleared (see the suspension handling in `extractAuthContext`),
 * and narrowing on both would reject a case the route never rejected
 * before.
 */
export async function requireAuthContext(
  req: NextRequest,
  prisma: PrismaClient,
  options?: RequireAuthContextOptions & { requireUserId?: true },
): Promise<{ ctx: AuthContext & { orgId: string; userId: string } } | { response: NextResponse }>;
export async function requireAuthContext(
  req: NextRequest,
  prisma: PrismaClient,
  options: RequireAuthContextOptions & { requireUserId: false },
): Promise<{ ctx: AuthContext & { orgId: string } } | { response: NextResponse }>;
export async function requireAuthContext(
  req: NextRequest,
  prisma: PrismaClient,
  options: RequireAuthContextOptions & { requireUserId?: boolean } = {},
): Promise<{ ctx: AuthContext } | { response: NextResponse }> {
  const {
    allowHeader = true,
    unauthorizedMessage = 'Unauthorized',
    requireUserId = true,
  } = options;
  const authHeader = allowHeader ? req.headers.get('authorization') : null;
  const cookieToken = req.cookies.get('access_token')?.value ?? null;
  const ctx = await extractAuthContext(authHeader, cookieToken, prisma);

  if (!ctx.orgId || (requireUserId && !ctx.userId)) {
    return { response: NextResponse.json({ error: unauthorizedMessage }, { status: 401 }) };
  }
  return { ctx };
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
 * Gate for the cross-tenant platform console. Verifies the caller is an
 * authenticated user carrying the global `isPlatformAdmin` flag AND is not
 * currently impersonating someone — an impersonated session must never be
 * able to wield platform-admin powers, even if the impersonated target
 * happens to be an admin too.
 *
 * Assertion signatures can't be async, so this returns the caller's id
 * instead of narrowing `ctx` — pair it with `requireUserId(ctx)` when you
 * also need `ctx.userId` narrowed to non-null.
 */
export async function requirePlatformAdmin(
  prisma: PrismaClient,
  ctx: AuthContext,
): Promise<string> {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
  if (ctx.impersonatorId) {
    throw new GraphQLError('Platform admin actions are not allowed while impersonating', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
  const user = await prisma.user.findUnique({
    select: { isPlatformAdmin: true },
    where: { id: ctx.userId },
  });
  if (!user?.isPlatformAdmin) {
    throw new GraphQLError('Platform admin access required', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
  return ctx.userId;
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
