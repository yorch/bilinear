import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';

/**
 * GET /api/integrations/github
 *
 * Initiates the GitHub OAuth flow. Caller must be an org owner or admin.
 * The caller must supply a `webhookSecret` query param — this is the shared
 * secret they will configure in GitHub's webhook settings so we can validate
 * incoming pull_request events.
 *
 * Redirects to GitHub's authorize endpoint with a state param that encodes
 * {orgId, userId, webhookSecret} so the callback can complete the connection.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GitHub integration is not configured' }, { status: 503 });
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

  // Only org owners and admins may connect a GitHub integration
  const membership = await prisma.organizationMember.findUnique({
    select: { role: true },
    where: { organizationId_userId: { organizationId: claims.orgId, userId: claims.userId } },
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const webhookSecret = (req.nextUrl.searchParams.get('webhookSecret') ?? '').trim();
  if (webhookSecret.length < 16) {
    return NextResponse.json(
      { error: 'webhookSecret must be at least 16 characters' },
      { status: 400 },
    );
  }

  // Encode state as base64 JSON so the callback can extract orgId + webhookSecret
  const statePayload = Buffer.from(
    JSON.stringify({ orgId: claims.orgId, userId: claims.userId, webhookSecret }),
  ).toString('base64url');

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/integrations/github/callback`;

  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'read:user');
  authUrl.searchParams.set('state', statePayload);

  return NextResponse.redirect(authUrl.toString());
}
