import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import { ScimService } from '@/server/services/scim.service';

const scimService = new ScimService(prisma);

export { scimService };

export function scimError(status: number, detail: string): Response {
  return NextResponse.json(
    {
      detail,
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status,
    },
    { status },
  );
}

export async function authenticateScim(req: NextRequest): Promise<{ orgId: string } | Response> {
  const auth = req.headers.get('authorization');
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) {
    return scimError(401, 'Missing Bearer token');
  }
  const ctx = await scimService.authenticateScimToken(bearer);
  if (!ctx) {
    return scimError(401, 'Invalid token');
  }
  return ctx;
}

/**
 * Map a Prisma User row to a SCIM 2.0 User resource object.
 */
export function userToScim(user: {
  active: boolean;
  createdAt: Date;
  displayName: string | null;
  email: string;
  id: string;
  updatedAt: Date;
}) {
  return {
    active: user.active,
    emails: [{ primary: true, value: user.email }],
    id: user.id,
    meta: {
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      resourceType: 'User',
    },
    name: { formatted: user.displayName ?? user.email },
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    userName: user.email,
  };
}

/**
 * Map a Prisma Team row to a SCIM 2.0 Group resource object.
 */
export function teamToScim(
  team: {
    createdAt: Date;
    displayName: string;
    id: string;
    updatedAt: Date;
  },
  members: { displayName: string | null; email: string; id: string }[] = [],
) {
  return {
    displayName: team.displayName,
    id: team.id,
    members: members.map(m => ({
      display: m.displayName ?? m.email,
      value: m.id,
    })),
    meta: {
      created: team.createdAt.toISOString(),
      lastModified: team.updatedAt.toISOString(),
      resourceType: 'Group',
    },
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
  };
}

/** Fetch all members of a team, returning the minimal user shape used by SCIM responses. */
export async function getTeamMembers(
  teamId: string,
): Promise<{ displayName: string | null; email: string; id: string }[]> {
  const memberships = await prisma.teamMembership.findMany({
    include: {
      user: { select: { displayName: true, email: true, id: true } },
    },
    where: { teamId },
  });
  return memberships.map(m => m.user);
}

export function listResponse(totalResults: number, resources: unknown[], startIndex = 1) {
  return {
    itemsPerPage: resources.length,
    Resources: resources,
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    startIndex,
    totalResults,
  };
}
