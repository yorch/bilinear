import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { joinOrganization } from '@/server/lib/membership-sync';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import { SyncService } from '@/server/services/sync.service';
import { isFirstUser } from '@/server/services/user.service';
import { authenticateScim, listResponse, scimError, userToScim } from '../_scim-auth';

/**
 * SCIM 2.0 Users collection endpoint.
 *
 * GET  /api/scim/v2/Users — list org members
 * POST /api/scim/v2/Users — provision a user (create if new, add to org)
 *
 * Filtering: ?filter=userName eq "email@example.com"
 * Pagination: ?startIndex=1&count=100
 */

export async function GET(req: NextRequest) {
  const auth = await authenticateScim(req);
  if (auth instanceof Response) {
    return auth;
  }

  const { searchParams } = new URL(req.url);
  const filterRaw = searchParams.get('filter') ?? '';
  const startIndex = Math.max(1, Number(searchParams.get('startIndex') ?? '1'));
  const count = Math.min(200, Math.max(1, Number(searchParams.get('count') ?? '100')));

  // Parse simple "userName eq <value>" filter.
  let emailFilter: string | null = null;
  const filterMatch = filterRaw.match(/userName\s+eq\s+"([^"]+)"/i);
  if (filterMatch) {
    emailFilter = filterMatch[1];
  }

  const where = {
    organizationId: auth.orgId,
    ...(emailFilter ? { user: { email: emailFilter } } : {}),
  };

  const [members, totalResults] = await Promise.all([
    prisma.organizationMember.findMany({
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
      skip: startIndex - 1,
      take: count,
      where,
    }),
    prisma.organizationMember.count({ where }),
  ]);

  const resources = members.map(m => userToScim(m.user));
  return NextResponse.json(listResponse(totalResults, resources, startIndex), { status: 200 });
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

  const userName = body.userName;
  if (typeof userName !== 'string' || !userName.trim()) {
    return scimError(400, 'userName is required');
  }

  const email = userName.trim().toLowerCase();
  const nameObj = body.name as { formatted?: string } | undefined;
  const displayName = nameObj?.formatted?.trim() ?? null;

  const resolvedDisplayName = displayName ?? email;
  // Derive initials from display name (up to 2 chars).
  const initials =
    resolvedDisplayName
      .split(/\s+/)
      .map(w => w[0] ?? '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U';

  // Bootstrap the platform admin if this is the first account in the
  // deployment (create branch only runs when the user is new; an empty table
  // means this SCIM-provisioned user is the first). See UserService.isFirstUser.
  const platformAdmin = await isFirstUser(prisma);

  // Upsert user by email. Never touch user.active — SCIM (de)activation is org-scoped.
  const user = await prisma.user.upsert({
    create: {
      createdAt: new Date(),
      displayName: resolvedDisplayName,
      email,
      initials,
      isPlatformAdmin: platformAdmin,
      name: resolvedDisplayName,
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
    update: { displayName: displayName ?? undefined, updatedAt: new Date() },
    where: { email },
  });

  // Add to org as member (no-op if already a member). The roster is part of
  // the synced dataset, so a provisioning that skipped the broadcast would
  // leave every open client — indefinitely, since a warm Dexie cache never
  // re-bootstraps — showing a workspace the new member is missing from.
  await joinOrganization(prisma, new SyncService(prisma, redis), auth.orgId, user.id, 'member');

  return NextResponse.json(userToScim(user), { status: 201 });
}
