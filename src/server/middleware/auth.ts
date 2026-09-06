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
  /**
   * The caller's role in `orgId` (`owner` / `admin` / `member`), resolved once
   * per request by `extractAuthContext` from the membership row it already
   * reads for the session-validity check. `requireOrgRole` consults this
   * instead of issuing its own lookup — the row was already in hand, and the
   * second read was pure duplication on a path that runs for most mutations.
   *
   * Invariant: this is non-null exactly when `orgId` is. Anything that clears
   * `orgId` must clear this in the same assignment, or an authorization check
   * could pass against a workspace the session no longer holds.
   *
   * Freshness is per-request, with one exception the caching creates: GraphQL
   * runs root mutation fields serially against one context, so a field that
   * invalidates the caller's own membership must write the new answer back —
   * see `clearOrgSession`, and `organizationMemberUpdateRole` for the
   * demote-yourself case. Without that, a later field in the same document
   * authorizes against a membership an earlier field already deleted.
   */
  orgRole?: string | null;
  userId: string | null;
}

const EMPTY_CONTEXT: AuthContext = {
  apiKeyScopes: null,
  impersonatorId: null,
  orgId: null,
  orgRole: null,
  userId: null,
};

export interface SessionUserRow {
  active: boolean;
}

export interface SessionOrgRow {
  archivedAt: Date | null;
  suspendedAt: Date | null;
}

/**
 * The caller's `organization_members` row for the session's org, or null if
 * they have none. Only existence is consulted — per-role authorization is
 * `requireOrgRole`'s job — but the row shape is kept honest so callers fetch
 * something meaningful rather than a bare boolean.
 */
export interface SessionMembershipRow {
  role: string;
}

export interface SessionValidityResult {
  /** Present only when `valid` is `false` — for logging, not user-facing. */
  reason?: string;
  valid: boolean;
}

/**
 * Fail-closed "is this session still allowed to act" predicate, shared by
 * every long-lived-auth re-check in the app: `extractAuthContext` below
 * (every HTTP/GraphQL request), the WS server's periodic re-auth sweep
 * (`shouldTerminateConnection` in `server/ws/index.ts`), and the Yjs collab
 * server's `revalidateAccess` (`server/yjs/server.ts`).
 *
 * All three re-derive the same "user still active AND org not
 * suspended/archived AND user still belongs to that org" check against
 * freshly re-queried rows — previously written three times, and it had
 * drifted: this file's suspension check only invalidated on `org &&
 * (org.suspendedAt || org.archivedAt)` (a *missing* org row left the
 * session alone), while the other two fail-closed on a missing org
 * (`!org || org.suspendedAt || org.archivedAt`). This is the single source
 * of truth going forward — fail-closed: invalid whenever the user row is
 * missing/inactive, the org row is missing/suspended/archived, OR the
 * membership row is missing. A missing row is always treated as invalid,
 * never as "no constraint to check".
 *
 * The membership arm is what makes an access token's `orgId` claim
 * *verified* rather than merely signed. The claim is stamped at issue time
 * and lives for the token's full 24h, so before this check a user removed
 * from an org kept full access to it until the token expired. That was
 * survivable while every account had exactly one org — losing your only
 * membership is an edge case, and the org itself is usually what goes away.
 * Once a user can hold several memberships and switch between them,
 * revocation is an ordinary event ("remove Dana from the contractor org")
 * and a 24h tail on it is not acceptable.
 *
 * Operates on already-fetched rows (no DB access itself) so it's a pure,
 * trivially unit-testable predicate — callers own the query shape/timing
 * (e.g. `revalidateAccess` fetches `org` lazily, only after confirming the
 * user is active, to avoid a wasted query).
 */
export function checkSessionValidity(
  user: SessionUserRow | null | undefined,
  org: SessionOrgRow | null | undefined,
  membership: SessionMembershipRow | null | undefined,
): SessionValidityResult {
  if (!user?.active) {
    return { reason: 'user deactivated', valid: false };
  }
  if (!org || org.suspendedAt || org.archivedAt) {
    return { reason: 'org suspended or archived', valid: false };
  }
  if (!membership) {
    return { reason: 'not a member of this org', valid: false };
  }
  return { valid: true };
}

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
        organizationId: true,
        scopes: true,
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
      // The key's own org, stamped from the session that created it. This
      // used to be inferred as the user's oldest membership, which for a
      // multi-org account pointed the key at whichever workspace they
      // happened to join first rather than the one they were working in
      // when they created it. Keys predating the `organization_id` column
      // have none; they resolve to a null org and fail `requireAuth`
      // rather than silently guessing a tenant. The membership re-check
      // below then confirms the creator still belongs to that org, so
      // revoking someone's membership also disarms their API keys.
      const orgId = authToken.organizationId;
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
    // Two reads, run concurrently, on the app's hottest path (every
    // authenticated request). The membership is fetched *with* its org
    // rather than as a separate lookup: it's one traversal of the
    // `(organizationId, userId)` unique index plus the FK join, and both
    // rows feed the same predicate. Adding the membership check as a third
    // independent query would have been a permanent +50% on this path's
    // query count for no extra information.
    const orgId = resolved.orgId;
    const userId = resolved.userId;
    const [user, membership] = await Promise.all([
      prisma.user.findUnique({
        select: { active: true },
        where: { id: userId },
      }),
      orgId
        ? prisma.organizationMember.findUnique({
            select: {
              organization: { select: { archivedAt: true, suspendedAt: true } },
              role: true,
            },
            where: { organizationId_userId: { organizationId: orgId, userId } },
          })
        : Promise.resolve(null),
    ]);
    // No membership means no org row either, so `checkSessionValidity`
    // reports the org arm rather than the membership arm. Both drop `orgId`
    // and nothing branches on the difference — it only affects which reason
    // string is available for logging.
    const validity = checkSessionValidity(user, membership?.organization, membership);
    if (!validity.valid) {
      if (validity.reason === 'user deactivated') {
        return { ...EMPTY_CONTEXT };
      }
      // Org unusable (suspended, archived, a missing row, or — see
      // checkSessionValidity's doc comment — the caller no longer being a
      // member of it) drops only `orgId`, not the whole session. That is
      // exactly right for multi-org: losing access to one workspace must
      // not sign you out of the others, and a session with a null `orgId`
      // still authenticates well enough to list the orgs you *can* reach
      // (`viewerOrganizations` needs only `requireUserId`) and switch into
      // one. NOTE the intentional tightening here: a missing org
      // row used to leave `orgId` untouched (only `org && (...)` invalidated,
      // so a null `org` from the lookup above was silently treated as "no
      // constraint"); `checkSessionValidity` fails closed on it instead. This
      // is safe in practice — `orgId` comes from a signed JWT and
      // `Organization` is FK-backed and never hard-deleted, so a missing org
      // row was already practically impossible. Fail-closing a case that
      // can't really happen is strictly more correct than the old
      // "practically impossible, and also would have silently kept working"
      // behavior.
      resolved = { ...resolved, orgId: null, orgRole: null };
    } else {
      // Carry the role the validity check already read, so `requireOrgRole`
      // doesn't re-fetch the same row. Cleared together with `orgId` above.
      resolved = { ...resolved, orgRole: membership?.role ?? null };
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

/**
 * Drop the request's organization after a field has invalidated the caller's
 * membership in it.
 *
 * GraphQL executes root mutation fields **serially against a single context**,
 * which is what the "nothing observes a role it changed itself" reasoning on
 * `orgRole` misses. A document selecting `organizationLeave` and then
 * `organizationInviteCreate` runs the second field after the first deleted
 * the membership, and its `requireOrgRole` reads the role resolved before the
 * operation began — mailing an admin invitation into a workspace the caller
 * provably no longer belongs to. Both fields have to go and they have to go
 * together: nulling `orgRole` alone still lets every
 * `requireAuth`-only mutation write into the workspace the caller just left,
 * and nulling `orgId` alone leaves a role string attached to no organization
 * (breaking the invariant documented on `orgRole`). Afterwards `requireAuth`
 * fails closed with UNAUTHENTICATED for the rest of the document, which is
 * the honest answer: the session names no workspace until its tokens are
 * re-issued.
 */
export function clearOrgSession(ctx: AuthContext): void {
  ctx.orgId = null;
  ctx.orgRole = null;
}

/**
 * Like `requireAuth` but only checks `userId`.
 *
 * Two callers need it: mutations that run before an org exists (onboarding),
 * and the platform-admin surfaces. `extractAuthContext` nulls `orgId` when the
 * caller's own organization is suspended or archived — deliberately, so a
 * platform admin can still reach `/admin` — so asserting both ids there answers
 * UNAUTHENTICATED to exactly the sessions the console exists for.
 */
export function requireUserId(ctx: AuthContext): asserts ctx is AuthContext & { userId: string } {
  if (!ctx.userId) {
    throw new GraphQLError('Not authenticated', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

/**
 * Assert the caller holds one of `roles` in their session's org, and return
 * which one.
 *
 * The return value matters: an owner and an admin both clear
 * `['owner', 'admin']`, but only an owner may grant or revoke ownership, so
 * the membership-management mutations need the *actual* role rather than a
 * bare pass/fail.
 *
 * Reads `ctx.orgRole`, which `extractAuthContext` resolved from the membership
 * row it must load anyway. It used to take `(prisma, orgId, userId, roles)`
 * and re-query that row at each of its ~25 call sites — a second traversal of
 * the same unique index, per mutation, for a value the request already had.
 * Synchronous now, because there is nothing left to await.
 *
 * Fails closed: a session with no `orgRole` (unauthenticated, or an org whose
 * membership failed revalidation) never satisfies any role list.
 */
/**
 * Whether the caller administers the current org (`owner` or `admin`).
 * Reads `ctx.orgRole`, which `extractAuthContext` resolves once per request
 * — never re-query `organizationMember` for this.
 */
export function isOrgAdmin(ctx: AuthContext): boolean {
  if (!ctx.orgId) {
    return false;
  }
  return ctx.orgRole === 'owner' || ctx.orgRole === 'admin';
}

export function requireOrgRole(ctx: AuthContext, roles: string[]): string {
  const role = ctx.orgId ? (ctx.orgRole ?? null) : null;

  if (!role || !roles.includes(role)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }
  return role;
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
