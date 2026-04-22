import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import {
  SyncService,
  serializeSyncAction,
} from '@/server/services/sync.service';

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

  let orgId: string;
  try {
    ({ orgId } = await verifyAccessToken(token));
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
    const actions = await syncService.getDeltaSyncActions(
      orgId,
      lastSyncId,
      toSyncId,
    );
    return NextResponse.json(actions.map(serializeSyncAction), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    logger.error({ err }, '[sync/delta] Error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
