import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { GitHubService } from '@/server/services/github.service';

const log = childLogger({ module: 'github-callback' });

/**
 * GET /api/integrations/github/callback
 *
 * GitHub OAuth callback. Exchanges the code for an access token, fetches the
 * GitHub user, and stores the integration. Redirects to the integrations
 * settings page when done.
 */
export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const settingsUrl = `${appUrl}/settings/integrations`;

  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');

  if (!code || !stateParam) {
    return NextResponse.redirect(`${settingsUrl}?error=missing_params`);
  }

  let orgId: string;
  let userId: string;
  let webhookSecret: string;

  try {
    const decoded = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8')) as {
      orgId: string;
      userId: string;
      webhookSecret: string;
    };
    orgId = decoded.orgId;
    userId = decoded.userId;
    webhookSecret = decoded.webhookSecret;
  } catch {
    return NextResponse.redirect(`${settingsUrl}?error=invalid_state`);
  }

  try {
    const service = new GitHubService(prisma);
    await service.connect(orgId, userId, { code, webhookSecret });
    log.info({ orgId }, 'GitHub integration connected');
  } catch (err) {
    const error = err as Error;
    log.error({ err, orgId }, 'GitHub connect failed');
    const code =
      error.name === 'GitHubIntegrationAlreadyConnectedError'
        ? 'already_connected'
        : 'connect_failed';
    return NextResponse.redirect(`${settingsUrl}?error=${code}`);
  }

  return NextResponse.redirect(`${settingsUrl}?connected=1`);
}
