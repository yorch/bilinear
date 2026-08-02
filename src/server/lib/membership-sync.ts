import type { OrganizationMember, PrismaClient } from '../../generated/prisma';
import { Prisma } from '../../generated/prisma';
import type { SyncActionType, SyncService } from '../services/sync.service';
import { USER_SYNC_OMIT } from '../services/sync.service';

/**
 * The slice of `SyncService` a membership broadcast needs. `Pick` rather than
 * a hand-written interface (the convention `AutomationService` already
 * follows) so the signature cannot drift from the real one.
 */
type MembershipSyncEmitter = Pick<SyncService, 'createSyncAction'>;

/**
 * The one way to add someone to an organization.
 *
 * Six places write `organization_members`, and four of them spelled the same
 * `upsert(… update: {})` out by hand while emitting nothing. That was
 * survivable while the members UI refetched its roster on every mount; it
 * stopped being survivable once the roster became part of the synced dataset,
 * because a membership written without a SyncAction never reaches any open
 * client — and a warm Dexie cache means "never" really is never, not "until
 * the next reload".
 *
 * This half does the write and reports whether anything actually changed.
 * Most callers want `joinOrganization`, which pairs it with the broadcast;
 * the two are separable only because invitation acceptance splits them across
 * a service (which does the write) and a resolver (which holds the
 * `SyncService`).
 *
 * `created: false` means the person was already a member: their existing role
 * is deliberately left alone (an invitation must not silently demote an
 * established member) and there is nothing to broadcast.
 */
export async function ensureMembership(
  prisma: Pick<PrismaClient, 'organizationMember'>,
  orgId: string,
  userId: string,
  role: string,
): Promise<{ created: boolean; membership: OrganizationMember }> {
  const existing = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (existing) {
    return { created: false, membership: existing };
  }

  // Not an upsert, because an upsert cannot tell the caller which branch it
  // took and this one has to. The unique constraint still decides the race:
  // two concurrent joins both miss the read above, one insert wins, and the
  // loser re-reads rather than reporting a creation that was not its own.
  try {
    const membership = await prisma.organizationMember.create({
      data: { organizationId: orgId, role, userId },
    });
    return { created: true, membership };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      });
      if (raced) {
        return { created: false, membership: raced };
      }
    }
    throw err;
  }
}

function emitMembership(
  sync: MembershipSyncEmitter,
  orgId: string,
  action: SyncActionType,
  membership: OrganizationMember,
): Promise<{ id: bigint }> {
  return sync.createSyncAction(orgId, action, 'OrganizationMember', membership.id, membership);
}

/**
 * Announce a role change or a removal to every client in the org.
 *
 * Deliberately cannot express `'I'`. A join needs a second row shipped with
 * it (see `announceJoin`), and this module exists precisely because "remember
 * to also do X" is what four of the six membership writers forgot. Leaving an
 * `'I'` reachable here would rebuild that failure one level up, with no type
 * error and no test to catch it — so the type refuses it and `announceJoin`
 * is the only way to say "new member".
 */
export async function broadcastMembership(
  sync: MembershipSyncEmitter,
  orgId: string,
  action: Exclude<SyncActionType, 'I'>,
  membership: OrganizationMember,
): Promise<{ id: bigint }> {
  return emitMembership(sync, orgId, action, membership);
}

/**
 * Announce a **new** member: the membership row *and* the person it points at.
 *
 * A membership `'I'` on its own is inert for a join. The bootstrap scopes
 * `users` to `orgMemberships: { some: { organizationId } }`, so a client that
 * was already running when someone joined has no `UserStore` row for them —
 * and the members list is the intersection of the two pools, so the new member
 * simply does not appear. (Removal and role changes don't have this problem:
 * the user row is already there, and `UserStore` is a directory that keeps it
 * afterwards.)
 *
 * The `User` action goes first so no client can observe a membership pointing
 * at a person it has never heard of.
 */
export async function announceJoin(
  prisma: Pick<PrismaClient, 'user'>,
  sync: MembershipSyncEmitter,
  orgId: string,
  membership: OrganizationMember,
): Promise<{ id: bigint }> {
  const user = await prisma.user.findUnique({
    omit: USER_SYNC_OMIT,
    where: { id: membership.userId },
  });
  if (user) {
    await sync.createSyncAction(orgId, 'I', 'User', user.id, user);
  }
  return emitMembership(sync, orgId, 'I', membership);
}

/**
 * Add someone to an organization and tell every client about it — the whole
 * of "they joined", so no caller has to remember the `if (created)` or which
 * of the two emit helpers a join needs. SCIM provisioning, SCIM
 * re-activation, and SAML JIT all go through this.
 *
 * Invitation acceptance is the one path that stays split, because its write
 * happens in a service and only the resolver holds a `SyncService`; it calls
 * `ensureMembership` and `announceJoin` directly.
 */
export async function joinOrganization(
  prisma: Pick<PrismaClient, 'organizationMember' | 'user'>,
  sync: MembershipSyncEmitter,
  orgId: string,
  userId: string,
  role: string,
): Promise<{ created: boolean; membership: OrganizationMember }> {
  const result = await ensureMembership(prisma, orgId, userId, role);
  if (result.created) {
    await announceJoin(prisma, sync, orgId, result.membership);
  }
  return result;
}
