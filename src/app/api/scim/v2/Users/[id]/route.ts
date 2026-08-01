import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import {
  LastOwnerError,
  MemberNotFoundError,
  OrganizationService,
} from '@/server/services/organization.service';
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
    await new OrganizationService(prisma).removeMember(orgId, userId, null);
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
  const membership = await resolveUser(auth.orgId, id);
  if (!membership) {
    return scimError(404, 'User not found');
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Invalid JSON body');
  }

  const nameObj = body.name as { formatted?: string } | undefined;
  const displayName = nameObj?.formatted?.trim() ?? undefined;
  const active = typeof body.active === 'boolean' ? body.active : undefined;

  if (active === false) {
    const failure = await deactivateUser(id, auth.orgId);
    if (failure) {
      return failure;
    }
  }

  const updated = await prisma.user.update({
    data: {
      displayName,
      updatedAt: new Date(),
    },
    select: {
      active: true,
      createdAt: true,
      displayName: true,
      email: true,
      id: true,
      updatedAt: true,
    },
    where: { id },
  });

  return NextResponse.json(userToScim(updated), { status: 200 });
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
  const membership = await resolveUser(auth.orgId, id);
  if (!membership) {
    return scimError(404, 'User not found');
  }

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

  if (active === false) {
    const failure = await deactivateUser(id, auth.orgId);
    if (failure) {
      return failure;
    }
  } else if (active === true) {
    // Re-provision: restore org membership if it was removed by a prior deactivation.
    await prisma.organizationMember.upsert({
      create: {
        createdAt: new Date(),
        organizationId: auth.orgId,
        role: 'member',
        updatedAt: new Date(),
        userId: id,
      },
      update: {},
      where: { organizationId_userId: { organizationId: auth.orgId, userId: id } },
    });
  }

  const updated = await prisma.user.update({
    data: {
      displayName,
      updatedAt: new Date(),
    },
    select: {
      active: true,
      createdAt: true,
      displayName: true,
      email: true,
      id: true,
      updatedAt: true,
    },
    where: { id },
  });

  return NextResponse.json(userToScim(updated), { status: 200 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;
  const membership = await resolveUser(auth.orgId, id);
  if (!membership) {
    return scimError(404, 'User not found');
  }

  // Deprovision from this org only — do not globally deactivate the user
  // account. Same single writer as `deactivateUser` above.
  const failure = await deactivateUser(id, auth.orgId);
  if (failure) {
    return failure;
  }

  return new Response(null, { status: 204 });
}
