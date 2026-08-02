import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { broadcastMembership, joinOrganization } from '@/server/lib/membership-sync';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import {
  LastOwnerError,
  MemberNotFoundError,
  OrganizationService,
} from '@/server/services/organization.service';
import { SyncService } from '@/server/services/sync.service';
import { authenticateScim, scimError, userToScim } from '../../_scim-auth';

/**
 * SCIM 2.0 User individual resource endpoint.
 *
 * GET    /api/scim/v2/Users/:id — fetch a user
 * PUT    /api/scim/v2/Users/:id — replace user attributes
 * PATCH  /api/scim/v2/Users/:id — partial update (Operations array)
 * DELETE /api/scim/v2/Users/:id — deprovision user (soft)
 */

async function resolveUser(orgId: string, userId: string) {
  return prisma.organizationMember.findUnique({
    include: {
      user: {
        select: {
          active: true,
          createdAt: true,
          displayName: true,
          email: true,
          id: true,
          updatedAt: true,
        },
      },
    },
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
}

/**
 * Deprovision a user from this org, shared by PUT/PATCH (`active: false`)
 * and DELETE.
 *
 * Delegates to the one implementation of "remove a member"
 * (`OrganizationService.removeMember`) rather than re-issuing the deletes, so
 * SCIM inherits its invariants — notably the last-owner guard, whose absence
 * here previously let an IdP strand a workspace by deactivating its sole
 * owner. `actor: null` marks this a system caller: the self-removal and
 * owner-manages-owner checks are about people and don't apply, but the
 * structural guard does. Never touches `user.active` — that is global; SCIM
 * (de)activation is org-scoped.
 *
 * Returns a SCIM error Response the caller should return as-is, or null on
 * success. Deprovisioning someone already gone is a no-op, not an error:
 * IdPs retry, and SCIM operations are expected to be idempotent.
 */
async function deactivateUser(userId: string, orgId: string): Promise<Response | null> {
  try {
    const removed = await new OrganizationService(prisma).removeMember(orgId, userId, null);
    // The roster is synced, so the removal has to be announced or it never
    // reaches an open client: the deprovisioned member would keep appearing
    // in every admin's members list, with actions that all return NOT_FOUND.
    await broadcastMembership(new SyncService(prisma, redis), orgId, 'D', removed);
  } catch (err) {
    if (err instanceof MemberNotFoundError) {
      return null;
    }
    if (err instanceof LastOwnerError) {
      // 400 rather than 500: the IdP asked for something the workspace's own
      // invariants forbid, and repeating the request won't help.
      return scimError(400, err.message);
    }
    throw err;
  }
  return null;
}

/**
 * Apply an `active` change from PUT or PATCH, having first decided whether
 * this org may act on the target at all.
 *
 * The membership lookup happens here rather than at the top of each handler
 * because `active: true` is the one operation that legitimately names someone
 * with **no** membership row — deprovisioning deletes it outright, and
 * re-activation is how it comes back. Resolving org-scoped and 404'ing up
 * front is what made re-activation unreachable: every attempt failed on the
 * very row the deactivation had removed, so SCIM could deprovision but never
 * undo it.
 *
 * Re-provisioning is not a new privilege — `POST /Users` already lets an
 * org's SCIM token add an arbitrary address to that org, and this reaches the
 * same set of people by id instead of by email.
 *
 * Returns a SCIM error Response the caller should return as-is, or null to
 * carry on. An `active: true` for someone already a member — the routine
 * attribute sync an IdP sends constantly — costs no extra queries.
 */
async function applyActiveChange(
  userId: string,
  orgId: string,
  active: boolean | undefined,
): Promise<Response | null> {
  const membership = await resolveUser(orgId, userId);

  if (!membership) {
    if (active !== true) {
      return scimError(404, 'User not found');
    }
    // Genuinely re-provisioning: the org has no record of this person, so the
    // user has to be resolved globally before they can be re-admitted.
    const user = await prisma.user.findUnique({ select: { id: true }, where: { id: userId } });
    if (!user) {
      return scimError(404, 'User not found');
    }
    await joinOrganization(prisma, new SyncService(prisma, redis), orgId, userId, 'member');
    return null;
  }

  if (active === false) {
    return deactivateUser(userId, orgId);
  }
  return null;
}

/** The identical tail of PUT and PATCH: write the name through, answer SCIM. */
async function respondWithUpdatedUser(userId: string, displayName: string | undefined) {
  const updated = await prisma.user.update({
    data: { displayName, updatedAt: new Date() },
    select: {
      active: true,
      createdAt: true,
      displayName: true,
      email: true,
      id: true,
      updatedAt: true,
    },
    where: { id: userId },
  });
  return NextResponse.json(userToScim(updated), { status: 200 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;
  const membership = await resolveUser(auth.orgId, id);
  if (!membership) {
    return scimError(404, 'User not found');
  }
  return NextResponse.json(userToScim(membership.user), { status: 200 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Invalid JSON body');
  }

  const nameObj = body.name as { formatted?: string } | undefined;
  const displayName = nameObj?.formatted?.trim() ?? undefined;
  const active = typeof body.active === 'boolean' ? body.active : undefined;

  // After the body, deliberately: see `applyActiveChange`.
  const failure = await applyActiveChange(id, auth.orgId, active);
  if (failure) {
    return failure;
  }

  return respondWithUpdatedUser(id, displayName);
}

interface ScimOperation {
  op: string;
  path?: string;
  value?: unknown;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;

  let body: { Operations?: ScimOperation[] };
  try {
    body = (await req.json()) as { Operations?: ScimOperation[] };
  } catch {
    return scimError(400, 'Invalid JSON body');
  }

  const ops = body.Operations ?? [];
  let displayName: string | undefined;
  let active: boolean | undefined;

  for (const op of ops) {
    const path = op.path?.toLowerCase();
    const opLower = op.op?.toLowerCase();
    if (opLower === 'replace' || opLower === 'add') {
      if (path === 'name' || path === 'name.formatted') {
        displayName = typeof op.value === 'string' ? op.value : undefined;
      } else if (path === 'active') {
        active = typeof op.value === 'boolean' ? op.value : undefined;
      } else if (!path && typeof op.value === 'object' && op.value !== null) {
        const val = op.value as Record<string, unknown>;
        if (typeof val.active === 'boolean') {
          active = val.active;
        }
        const nameObj = val.name as { formatted?: string } | undefined;
        if (nameObj?.formatted) {
          displayName = nameObj.formatted;
        }
      }
    } else if (opLower === 'remove' && path === 'active') {
      // Removing the active attribute re-enables the user (active defaults true).
      active = true;
    }
  }

  // After the Operations are parsed, deliberately: see `applyActiveChange`.
  const failure = await applyActiveChange(id, auth.orgId, active);
  if (failure) {
    return failure;
  }

  return respondWithUpdatedUser(id, displayName);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;

  // No membership pre-check: `deactivateUser` already treats "already gone"
  // as success, and a 404 here made that documented idempotency unreachable
  // from the endpoint IdPs retry the most.
  //
  // Deprovision from this org only — do not globally deactivate the user
  // account. Same single writer as `deactivateUser` above.
  const failure = await deactivateUser(id, auth.orgId);
  if (failure) {
    return failure;
  }

  return new Response(null, { status: 204 });
}
