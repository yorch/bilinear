import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { redis } from '@/server/lib/redis';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { extractAuthContext, getGuestTeamIds } from '@/server/middleware/auth';
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
  // Routed through extractAuthContext (not a raw verifyAccessToken call) so
  // a deactivated user or a suspended/archived org is rejected here too —
  // see bootstrap/route.ts for the same reasoning.
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('access_token')?.value ?? null;
  const ctx = await extractAuthContext(authHeader, cookieToken, prisma);

  if (!ctx.orgId || !ctx.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { orgId, userId } = ctx;
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
  const guestTeamIds = await getGuestTeamIds(prisma, userId, orgId);

  try {
    const { actions, hasMore } = await syncService.getDeltaSyncActions(
      orgId,
      fromCursor,
      toCursor,
      undefined,
      guestTeamIds.length > 0 ? { guestTeamIds, userId } : undefined,
    );
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
