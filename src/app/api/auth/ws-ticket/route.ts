import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { signWsTicket, verifyAccessToken } from '@/server/lib/jwt';

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
  const accessToken = req.cookies.get('access_token')?.value ?? null;
  if (!accessToken) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let claims: { orgId: string; userId: string };
  try {
    claims = await verifyAccessToken(accessToken);
  } catch {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 401 });
  }

  if (!claims.orgId || !claims.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const ticket = await signWsTicket({ orgId: claims.orgId, userId: claims.userId });

  return NextResponse.json(
    { orgId: claims.orgId, ticket, userId: claims.userId },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
