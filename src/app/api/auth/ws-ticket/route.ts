import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { signWsTicket } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { requireAuthContext } from '@/server/middleware/auth';

/**
 * GET /api/auth/ws-ticket
 *
 * Reads the httpOnly access cookie and returns a short-lived (60s)
 * `ws_ticket` JWT plus the caller's `userId` / `orgId`. The ticket is
 * scoped to the WebSocket endpoint only — it cannot be used for any other
 * authenticated request — so handing it to client JavaScript does not
 * defeat httpOnly on the long-lived access token.
 *
 * The ticket carries the same userId/orgId claims so the WS server only
 * needs to verify the ticket, not the access cookie.
 */
export async function GET(req: NextRequest) {
  // Routed through requireAuthContext (not a raw verifyAccessToken call) so
  // a deactivated user or a suspended/archived org can't mint a fresh
  // real-time ws_ticket off a still-valid JWT — see sync/bootstrap/route.ts
  // for the same reasoning. Cookie-only (no Authorization header/API-key
  // path) — unchanged from prior behavior, this endpoint is only ever
  // called from the authenticated browser session.
  const authResult = await requireAuthContext(req, prisma, {
    allowHeader: false,
    unauthorizedMessage: 'Not authenticated',
  });
  if ('response' in authResult) {
    return authResult.response;
  }
  const { ctx } = authResult;

  const ticket = await signWsTicket({ orgId: ctx.orgId, userId: ctx.userId });

  return NextResponse.json(
    { orgId: ctx.orgId, ticket, userId: ctx.userId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
