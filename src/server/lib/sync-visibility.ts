import type { PrismaClient } from '../../generated/prisma';

/**
 * What one caller may receive from the replicated dataset.
 *
 * The GraphQL layer enforces two visibility rules per request: a `guest` on a
 * team sees only the issues they created or are assigned to, and a *private*
 * team is invisible to everyone who is not a member of it. The offline-first
 * paths (bootstrap, delta, the WebSocket fan-out) ship rows without going
 * through those resolvers, so they need the same two facts up front. This is
 * that scope, computed once per request (or once per socket) and threaded
 * into every place rows leave the server.
 *
 * `hiddenTeamIds` is the set of private teams in the org the caller is NOT a
 * member of: nothing team-scoped from those teams may be sent — not the team
 * row, not its workflow states, cycles, templates, views, documents, issues
 * or anything derived from an issue. `guestTeamIds` is the set of teams where
 * the caller holds the `guest` role: team-scoped metadata is visible there,
 * but issues (and issue-derived rows) are narrowed to the caller's own work.
 */
export interface SyncVisibility {
  guestTeamIds: string[];
  hiddenTeamIds: string[];
  userId: string;
}

/** True when the scope narrows nothing — the fast path skips every filter. */
export function isUnrestricted(v: SyncVisibility): boolean {
  return v.guestTeamIds.length === 0 && v.hiddenTeamIds.length === 0;
}

/** Resolve the visibility scope for one (user, org) pair. */
export async function getSyncVisibility(
  prisma: PrismaClient,
  userId: string,
  orgId: string,
): Promise<SyncVisibility> {
  const [scope] = await getSyncVisibilityBatch(prisma, [{ orgId, userId }]);
  return scope ?? { guestTeamIds: [], hiddenTeamIds: [], userId };
}

/**
 * Resolve visibility for many (user, org) pairs in two queries, regardless of
 * how many pairs there are. The WebSocket server's re-auth sweep uses this to
 * refresh every live socket at once — a private flag flipped or a membership
 * removed must stop the stream within one sweep, and one round-trip per
 * socket would make the sweep cost scale with connections rather than with
 * distinct users.
 */
export async function getSyncVisibilityBatch(
  prisma: PrismaClient,
  pairs: ReadonlyArray<{ orgId: string; userId: string }>,
): Promise<SyncVisibility[]> {
  if (pairs.length === 0) {
    return [];
  }
  const orgIds = [...new Set(pairs.map(p => p.orgId))];
  const userIds = [...new Set(pairs.map(p => p.userId))];

  const [privateTeams, guestRoles] = await Promise.all([
    prisma.team.findMany({
      select: {
        id: true,
        memberships: { select: { userId: true }, where: { userId: { in: userIds } } },
        organizationId: true,
      },
      where: { archivedAt: null, organizationId: { in: orgIds }, private: true },
    }),
    prisma.teamMemberRole.findMany({
      select: { team: { select: { organizationId: true } }, teamId: true, userId: true },
      where: {
        role: 'guest',
        team: { archivedAt: null, organizationId: { in: orgIds } },
        userId: { in: userIds },
      },
    }),
  ]);

  return pairs.map(({ orgId, userId }) => ({
    guestTeamIds: guestRoles
      .filter(r => r.userId === userId && r.team.organizationId === orgId)
      .map(r => r.teamId),
    hiddenTeamIds: privateTeams
      .filter(t => t.organizationId === orgId && !t.memberships.some(m => m.userId === userId))
      .map(t => t.id),
    userId,
  }));
}
