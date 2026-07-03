import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyGithubOAuthState } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { GitHubService } from '@/server/services/github.service';

const log = childLogger({ module: 'github-callback' });

/**
 * GET /api/integrations/github/callback
 *
 * GitHub OAuth callback. Exchanges the code for an access token, fetches the
 * GitHub user, and stores the integration. Redirects to the integrations
 * settings page when done.
 */
async function handleGet(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const fallbackUrl = `${appUrl}`;

  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');

  if (!code || !stateParam) {
    return NextResponse.redirect(`${fallbackUrl}?error=missing_params`);
  }

  let orgId: string;
  let userId: string;
  let webhookSecret: string;

  try {
    const decoded = await verifyGithubOAuthState(stateParam);
    orgId = decoded.orgId;
    userId = decoded.userId;
    webhookSecret = decoded.webhookSecret;
  } catch {
    return NextResponse.redirect(`${fallbackUrl}?error=invalid_state`);
  }
  bindRequestContext({ orgId, userId });

  // Defense in depth: confirm the initiating user is still an owner/admin of
  // the org before completing the connection (the signed state proves they
  // were at initiation; this guards against a role change in between).
  const membership = await prisma.organizationMember.findUnique({
    select: { role: true },
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.redirect(`${fallbackUrl}?error=forbidden`);
  }

  // Resolve workspace URL key so we can redirect to the correct scoped settings page
  const org = await prisma.organization.findUnique({
    select: { urlKey: true },
    where: { id: orgId },
  });
  const settingsUrl = org
    ? `${appUrl}/${org.urlKey}/settings/integrations`
    : `${fallbackUrl}/settings/integrations`;

  try {
    const service = new GitHubService(prisma);
    await service.connect(orgId, userId, { code, webhookSecret });
    log.info({ orgId }, 'GitHub integration connected');
  } catch (err) {
    const error = err as Error;
    log.error({ err, orgId }, 'GitHub connect failed');
    const errCode =
      error.name === 'GitHubIntegrationAlreadyConnectedError'
        ? 'already_connected'
        : 'connect_failed';
    return NextResponse.redirect(`${settingsUrl}?error=${errCode}`);
  }

  return NextResponse.redirect(`${settingsUrl}?connected=1`);
}

export const GET = withRequestContext('integrations/github/callback', handleGet);
