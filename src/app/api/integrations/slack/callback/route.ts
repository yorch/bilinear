import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
import { verifySlackOAuthState } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { extractAuthContext } from '@/server/middleware/auth';
import { IssueService } from '@/server/services/issue.service';
import { exchangeSlackCode, SlackService } from '@/server/services/slack.service';

const log = childLogger({ module: 'slack-callback' });

/**
 * GET /api/integrations/slack/callback
 *
 * Slack OAuth v2 callback: exchanges the code for a bot token and stores the
 * integration, then redirects to the integrations settings page.
 */
async function handleGet(req: NextRequest) {
  const appUrl = env.APP_URL;

  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  if (!code || !stateParam) {
    return NextResponse.redirect(`${appUrl}?error=missing_params`);
  }

  let orgId: string;
  let userId: string;
  try {
    const decoded = await verifySlackOAuthState(stateParam);
    orgId = decoded.orgId;
    userId = decoded.userId;
  } catch {
    return NextResponse.redirect(`${appUrl}?error=invalid_state`);
  }
  bindRequestContext({ orgId, userId });

  // The signed state proves who STARTED the flow, not who is finishing it.
  // The provider redirects whichever browser completes the consent screen, so
  // an attacker could start the flow for their own org, hand the authorize
  // URL to an admin of another org, and have that admin's provider account
  // bound to the attacker's workspace. Require the finishing browser to hold
  // the session the state was minted for.
  const session = await extractAuthContext(
    null,
    req.cookies.get('access_token')?.value ?? null,
    prisma,
  );
  if (session.userId !== userId || session.orgId !== orgId) {
    return NextResponse.redirect(`${appUrl}?error=session_mismatch`);
  }

  const membership = await prisma.organizationMember.findUnique({
    select: { role: true },
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.redirect(`${appUrl}?error=forbidden`);
  }

  const org = await prisma.organization.findUnique({
    select: { urlKey: true },
    where: { id: orgId },
  });
  const settingsUrl = org
    ? `${appUrl}/${org.urlKey}/settings/integrations`
    : `${appUrl}/settings/integrations`;

  try {
    const redirectUri = `${appUrl}/api/integrations/slack/callback`;
    const token = await exchangeSlackCode(code, redirectUri);
    if (!token.ok || !token.access_token || !token.team?.id) {
      log.error({ error: token.error, orgId }, 'Slack token exchange failed');
      return NextResponse.redirect(`${settingsUrl}?error=connect_failed`);
    }
    const service = new SlackService(prisma, new IssueService(prisma));
    await service.connect(orgId, userId, {
      accessToken: token.access_token,
      botUserId: token.bot_user_id ?? '',
      slackTeamId: token.team.id,
      slackTeamName: token.team.name ?? 'Slack workspace',
    });
    log.info({ orgId }, 'Slack integration connected');
  } catch (err) {
    log.error({ err, orgId }, 'Slack connect failed');
    return NextResponse.redirect(`${settingsUrl}?error=connect_failed`);
  }

  return NextResponse.redirect(`${settingsUrl}?slack_connected=1`);
}

export const GET = withRequestContext('integrations/slack/callback', handleGet);
