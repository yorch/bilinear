import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
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
 *
 * It also returns `wsUrl` — the endpoint the browser should connect to.
 * This endpoint is already fetched on every (re)connect, so it costs no
 * extra round-trip, and being read at REQUEST time it is the only way to
 * make the URL configurable for a deployment running a prebuilt image
 * (`NEXT_PUBLIC_*` is inlined at build time). `null` means "unconfigured" —
 * the client then falls back to its build-time default. See
 * `src/lib/ws-url.ts`.
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
    { orgId: ctx.orgId, ticket, userId: ctx.userId, wsUrl: env.WS_PUBLIC_URL },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
