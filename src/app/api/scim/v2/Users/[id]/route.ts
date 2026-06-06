import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
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

async function deactivateUser(userId: string, orgId: string) {
  await prisma.$transaction([
    // Mark user inactive.
    prisma.user.update({
      data: { active: false, updatedAt: new Date() },
      where: { id: userId },
    }),
    // Remove from all teams in org.
    prisma.teamMembership.deleteMany({
      where: { team: { organizationId: orgId }, userId },
    }),
  ]);
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
    await deactivateUser(id, auth.orgId);
  }

  const updated = await prisma.user.update({
    data: {
      active: active ?? undefined,
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
    if (op.op?.toLowerCase() === 'replace') {
      if (path === 'name' || path === 'name.formatted') {
        displayName = typeof op.value === 'string' ? op.value : undefined;
      } else if (path === 'active') {
        active = typeof op.value === 'boolean' ? op.value : undefined;
      } else if (!path && typeof op.value === 'object' && op.value !== null) {
        // Whole-object replace with no path
        const val = op.value as Record<string, unknown>;
        if (typeof val.active === 'boolean') {
          active = val.active;
        }
        const nameObj = val.name as { formatted?: string } | undefined;
        if (nameObj?.formatted) {
          displayName = nameObj.formatted;
        }
      }
    }
  }

  if (active === false) {
    await deactivateUser(id, auth.orgId);
  }

  const updated = await prisma.user.update({
    data: {
      active: active ?? undefined,
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

  await prisma.$transaction([
    prisma.user.update({
      data: { active: false, updatedAt: new Date() },
      where: { id },
    }),
    // Remove from org membership.
    prisma.organizationMember.delete({
      where: { organizationId_userId: { organizationId: auth.orgId, userId: id } },
    }),
    // Remove from all teams in org.
    prisma.teamMembership.deleteMany({
      where: { team: { organizationId: auth.orgId }, userId: id },
    }),
  ]);

  return new Response(null, { status: 204 });
}
