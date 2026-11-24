import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
import { signGithubOAuthState } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { requireAuthContext } from '@/server/middleware/auth';

/**
 * GET /api/integrations/github
 *
 * Initiates the GitHub OAuth flow. Caller must be an org owner or admin.
 *
 * Redirects to GitHub's authorize endpoint with a signed state param that
 * encodes {orgId, userId}. The state is signed, not encrypted, and is visible
 * to github.com, the callback URL, browser history and logs, so it carries NO
 * secret: the webhook secret is generated in the callback right before the
 * connection is stored.
 */
export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GitHub integration is not configured' }, { status: 503 });
  }

  // Routed through requireAuthContext (not a raw verifyAccessToken call) so
  // a deactivated user or a suspended/archived org can't kick off a new
  // GitHub OAuth connection off a still-valid JWT — see
  // sync/bootstrap/route.ts for the same reasoning. Cookie-only (no
  // Authorization header/API-key path) — unchanged from prior behavior.
  const authResult = await requireAuthContext(req, prisma, {
    allowHeader: false,
    unauthorizedMessage: 'Not authenticated',
  });
  if ('response' in authResult) {
    return authResult.response;
  }
  const { ctx } = authResult;
  const claims = { orgId: ctx.orgId, userId: ctx.userId };

  // Only org owners and admins may connect a GitHub integration
  const membership = await prisma.organizationMember.findUnique({
    select: { role: true },
    where: { organizationId_userId: { organizationId: claims.orgId, userId: claims.userId } },
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // Sign the state as a short-lived JWT so the callback can trust the
  // orgId/userId it carries. An unsigned blob would let an attacker forge a
  // callback binding a foreign org.
  const statePayload = await signGithubOAuthState({
    orgId: claims.orgId,
    userId: claims.userId,
  });

  const appUrl = env.APP_URL;
  const redirectUri = `${appUrl}/api/integrations/github/callback`;

  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'read:user');
  authUrl.searchParams.set('state', statePayload);

  return NextResponse.redirect(authUrl.toString());
}
