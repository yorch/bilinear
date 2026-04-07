import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import { SyncService, serializeSyncAction } from '@/server/services/sync.service';

/**
 * GET /api/sync/delta?lastSyncId=<N>&toSyncId=<N>
 *
 * Returns all SyncActions since lastSyncId (exclusive) up to toSyncId (inclusive, optional).
 * Response: JSON array of serialized SyncActions.
 */
export async function GET(req: NextRequest) {
  const token =
    req.cookies.get('access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  let orgId: string;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret));
    orgId = payload.orgId as string;
    if (!orgId) throw new Error('missing orgId');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const lastSyncIdParam = url.searchParams.get('lastSyncId');
  const toSyncIdParam = url.searchParams.get('toSyncId');

  if (!lastSyncIdParam) {
    return NextResponse.json(
      { error: 'lastSyncId query parameter is required' },
      { status: 400 },
    );
  }

  let lastSyncId: bigint;
  let toSyncId: bigint | undefined;
  try {
    lastSyncId = BigInt(lastSyncIdParam);
    toSyncId = toSyncIdParam ? BigInt(toSyncIdParam) : undefined;
  } catch {
    return NextResponse.json(
      { error: 'Invalid lastSyncId or toSyncId value' },
      { status: 400 },
    );
  }

  const syncService = new SyncService(prisma, redis);

  try {
    const actions = await syncService.getDeltaSyncActions(orgId, lastSyncId, toSyncId);
    return NextResponse.json(actions.map(serializeSyncAction));
  } catch (err) {
    console.error('[sync/delta] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
