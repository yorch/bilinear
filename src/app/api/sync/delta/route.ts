import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { parseCursor, SyncService, serializeSyncAction } from '@/server/services/sync.service';

/**
 * GET /api/sync/delta?lastSyncId=<cursor>&toSyncId=<cursor>
 *
 * Returns all SyncActions strictly after `lastSyncId` (exclusive), up to
 * `toSyncId` (inclusive, optional). Cursors are opaque strings encoding
 * a `(committedAt, id)` tuple — see `parseCursor` for the format. The
 * legacy `<id>` form is accepted for backward-compat with clients that
 * persisted the cursor before the encoding change.
 *
 * Response: { actions: SerializedSyncAction[]; hasMore: boolean }.
 */
async function handleGet(req: NextRequest) {
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
  bindRequestContext({ orgId });

  const url = new URL(req.url);
  const lastSyncIdParam = url.searchParams.get('lastSyncId');
  const toSyncIdParam = url.searchParams.get('toSyncId');

  if (!lastSyncIdParam) {
    return NextResponse.json({ error: 'lastSyncId query parameter is required' }, { status: 400 });
  }

  const fromCursor = parseCursor(lastSyncIdParam);
  const toCursor = toSyncIdParam ? parseCursor(toSyncIdParam) : undefined;

  const syncService = new SyncService(prisma, redis);

  try {
    const { actions, hasMore } = await syncService.getDeltaSyncActions(orgId, fromCursor, toCursor);
    return NextResponse.json(
      { actions: actions.map(serializeSyncAction), hasMore },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    logger.error({ err }, 'Delta sync failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withRequestContext('sync/delta', handleGet);
