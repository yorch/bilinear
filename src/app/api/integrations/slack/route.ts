import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
import { signSlackOAuthState, verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';

/**
 * GET /api/integrations/slack
 *
 * Initiates the Slack OAuth (v2) flow. Caller must be an org owner/admin.
 * Redirects to Slack's authorize endpoint with a signed state carrying
 * {orgId, userId} so the callback can complete the connection.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Slack integration is not configured' }, { status: 503 });
  }

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

  const membership = await prisma.organizationMember.findUnique({
    select: { role: true },
    where: { organizationId_userId: { organizationId: claims.orgId, userId: claims.userId } },
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const state = await signSlackOAuthState({ orgId: claims.orgId, userId: claims.userId });
  const appUrl = env.APP_URL;
  const redirectUri = `${appUrl}/api/integrations/slack/callback`;

  const authUrl = new URL('https://slack.com/oauth/v2/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  // commands: receive the slash command; chat:write: post the confirmation.
  authUrl.searchParams.set('scope', 'commands,chat:write');
  authUrl.searchParams.set('state', state);

  return NextResponse.redirect(authUrl.toString());
}
