import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import {
  authenticateScim,
  getTeamMembers,
  listResponse,
  scimError,
  teamToScim,
} from '../_scim-auth';

/**
 * SCIM 2.0 Groups collection endpoint.
 *
 * GET  /api/scim/v2/Groups — list teams for org
 * POST /api/scim/v2/Groups — create a team
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const teams = await prisma.team.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      displayName: true,
      id: true,
      updatedAt: true,
    },
    where: { archivedAt: null, organizationId: auth.orgId },
  });

  // Batch all member lookups in a single query instead of one per team.
  const teamIds = teams.map(t => t.id);
  const allMemberships = await prisma.teamMembership.findMany({
    include: { user: { select: { displayName: true, email: true, id: true } } },
    where: { teamId: { in: teamIds } },
  });
  const membersByTeamId = new Map<
    string,
    { displayName: string | null; email: string; id: string }[]
  >();
  for (const m of allMemberships) {
    const arr = membersByTeamId.get(m.teamId) ?? [];
    arr.push(m.user);
    membersByTeamId.set(m.teamId, arr);
  }
  const resources = teams.map(team => teamToScim(team, membersByTeamId.get(team.id) ?? []));

  return NextResponse.json(listResponse(teams.length, resources), { status: 200 });
}

export async function POST(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return scimError(400, 'Invalid JSON body');
  }

  const displayName = (body.displayName as string | undefined)?.trim();
  if (!displayName) {
    return scimError(400, 'displayName is required');
  }

  // Auto-generate a team key from the display name (uppercase letters only, max 10).
  const baseKey = displayName
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 10);
  const key = baseKey || 'TEAM';

  // Ensure key is unique within org by appending an incrementing suffix.
  let finalKey = key;
  for (let i = 2; i < 100; i++) {
    const taken = await prisma.team.findFirst({
      select: { id: true },
      where: { key: finalKey, organizationId: auth.orgId },
    });
    if (!taken) {
      break;
    }
    finalKey = `${key}${i}`;
  }

  const now = new Date();
  const team = await prisma.team.create({
    data: {
      createdAt: now,
      displayName,
      id: randomUUID(),
      key: finalKey,
      name: displayName,
      organizationId: auth.orgId,
      updatedAt: now,
    },
    select: {
      createdAt: true,
      displayName: true,
      id: true,
      updatedAt: true,
    },
  });

  // Handle optional initial members in body.
  const rawMembers = body.members;
  const memberValues: string[] = [];
  if (Array.isArray(rawMembers)) {
    for (const m of rawMembers as unknown[]) {
      if (
        typeof m === 'object' &&
        m !== null &&
        typeof (m as { value?: unknown }).value === 'string'
      ) {
        memberValues.push((m as { value: string }).value);
      }
    }
  }
  if (memberValues.length > 0) {
    await prisma.teamMembership.createMany({
      data: memberValues.map(userId => ({
        createdAt: now,
        id: randomUUID(),
        isOwner: false,
        sortOrder: 0,
        teamId: team.id,
        updatedAt: now,
        userId,
      })),
      skipDuplicates: true,
    });
  }

  const members = await getTeamMembers(team.id);
  return NextResponse.json(teamToScim(team, members), { status: 201 });
}
