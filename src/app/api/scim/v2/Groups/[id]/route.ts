import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import { authenticateScim, scimError, teamToScim } from '../../_scim-auth';

/**
 * SCIM 2.0 Group individual resource endpoint.
 *
 * GET    /api/scim/v2/Groups/:id — fetch team with members
 * PUT    /api/scim/v2/Groups/:id — replace displayName + member list
 * PATCH  /api/scim/v2/Groups/:id — partial update (add/remove members, rename)
 * DELETE /api/scim/v2/Groups/:id — archive team
 */

async function resolveTeam(orgId: string, teamId: string) {
  return prisma.team.findFirst({
    select: { createdAt: true, displayName: true, id: true, updatedAt: true },
    where: { archivedAt: null, id: teamId, organizationId: orgId },
  });
}

async function filterOrgMembers(orgId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) {
    return [];
  }
  const members = await prisma.organizationMember.findMany({
    select: { userId: true },
    where: { organizationId: orgId, userId: { in: userIds } },
  });
  return members.map(m => m.userId);
}

async function getTeamMembers(teamId: string) {
  const memberships = await prisma.teamMembership.findMany({
    include: {
      user: { select: { displayName: true, email: true, id: true } },
    },
    where: { teamId },
  });
  return memberships.map(m => m.user);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;
  const team = await resolveTeam(auth.orgId, id);
  if (!team) {
    return scimError(404, 'Group not found');
  }

  const members = await getTeamMembers(id);
  return NextResponse.json(teamToScim(team, members), { status: 200 });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;
  const team = await resolveTeam(auth.orgId, id);
  if (!team) {
    return scimError(404, 'Group not found');
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Invalid JSON body');
  }

  const displayName = (body.displayName as string | undefined)?.trim();
  const now = new Date();

  // Update display name if provided.
  if (displayName) {
    await prisma.team.update({
      data: { displayName, name: displayName, updatedAt: now },
      where: { id },
    });
  }

  // Sync member list — replace entirely.
  const rawMembers = body.members;
  if (Array.isArray(rawMembers)) {
    const newUserIds = (rawMembers as unknown[])
      .filter(
        (m): m is { value: string } =>
          typeof m === 'object' &&
          m !== null &&
          typeof (m as { value?: unknown }).value === 'string',
      )
      .map(m => m.value);

    // Delete memberships not in new list.
    await prisma.teamMembership.deleteMany({
      where: { teamId: id, userId: { notIn: newUserIds } },
    });

    // Create missing memberships — only for users that belong to this org.
    const validUserIds = await filterOrgMembers(auth.orgId, newUserIds);
    await prisma.teamMembership.createMany({
      data: validUserIds.map(userId => ({
        createdAt: now,
        id: randomUUID(),
        isOwner: false,
        sortOrder: 0,
        teamId: id,
        updatedAt: now,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  const updatedTeam = await resolveTeam(auth.orgId, id);
  const members = await getTeamMembers(id);
  return NextResponse.json(teamToScim(updatedTeam ?? team, members), { status: 200 });
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
  const team = await resolveTeam(auth.orgId, id);
  if (!team) {
    return scimError(404, 'Group not found');
  }

  let body: { Operations?: ScimOperation[] };
  try {
    body = (await req.json()) as { Operations?: ScimOperation[] };
  } catch {
    return scimError(400, 'Invalid JSON body');
  }

  const ops = body.Operations ?? [];
  const now = new Date();

  for (const op of ops) {
    const opLower = op.op?.toLowerCase();
    const path = op.path?.toLowerCase();

    if (opLower === 'replace' && path === 'displayname') {
      const displayName = typeof op.value === 'string' ? op.value.trim() : undefined;
      if (displayName) {
        await prisma.team.update({
          data: { displayName, name: displayName, updatedAt: now },
          where: { id },
        });
      }
    } else if (opLower === 'add' && path === 'members') {
      const values = Array.isArray(op.value) ? (op.value as unknown[]) : [];
      const userIds = values
        .filter(
          (v): v is { value: string } =>
            typeof v === 'object' &&
            v !== null &&
            typeof (v as { value?: unknown }).value === 'string',
        )
        .map(v => v.value);

      if (userIds.length > 0) {
        // Validate membership before granting team access.
        const validUserIds = await filterOrgMembers(auth.orgId, userIds);
        await prisma.teamMembership.createMany({
          data: validUserIds.map(userId => ({
            createdAt: now,
            id: randomUUID(),
            isOwner: false,
            sortOrder: 0,
            teamId: id,
            updatedAt: now,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    } else if (opLower === 'remove' && (path === 'members' || path?.startsWith('members['))) {
      let userIds: string[] = [];

      // Handle RFC 7644 value-filter: members[value eq "userId"] (Azure AD style).
      const filterMatch = op.path?.match(/^members\[value\s+eq\s+"([^"]+)"\]$/i);
      if (filterMatch?.[1]) {
        userIds = [filterMatch[1]];
      } else {
        const values = Array.isArray(op.value) ? (op.value as unknown[]) : [];
        userIds = values
          .filter(
            (v): v is { value: string } =>
              typeof v === 'object' &&
              v !== null &&
              typeof (v as { value?: unknown }).value === 'string',
          )
          .map(v => v.value);
      }

      if (userIds.length > 0) {
        await prisma.teamMembership.deleteMany({
          where: { teamId: id, userId: { in: userIds } },
        });
      }
    }
  }

  const updatedTeam = await resolveTeam(auth.orgId, id);
  const members = await getTeamMembers(id);
  return NextResponse.json(teamToScim(updatedTeam ?? team, members), { status: 200 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { id } = await params;
  const team = await resolveTeam(auth.orgId, id);
  if (!team) {
    return scimError(404, 'Group not found');
  }

  await prisma.team.update({
    data: { archivedAt: new Date(), updatedAt: new Date() },
    where: { id },
  });

  return new Response(null, { status: 204 });
}
