import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { IssueService } from '@/server/services/issue.service';
import { SlackService } from '@/server/services/slack.service';

const log = childLogger({ module: 'slack-commands' });

/**
 * POST /api/integrations/slack/commands
 *
 * Slash-command endpoint (configured once in the Slack app). Verifies the
 * request signature with SLACK_SIGNING_SECRET, then routes to the org that
 * owns the Slack workspace (team_id) to create an issue. Slash commands have
 * a fixed URL, so routing is by team_id rather than an org query param.
 */
async function handlePost(req: NextRequest) {
  const rawBody = await req.text();
  const ok = SlackService.verifySlashSignature(
    rawBody,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature'),
    process.env.SLACK_SIGNING_SECRET,
  );
  if (!ok) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const teamId = params.get('team_id');
  if (!teamId) {
    return NextResponse.json({ error: 'Missing team_id' }, { status: 400 });
  }
  bindRequestContext({ slackTeamId: teamId });

  try {
    const service = new SlackService(prisma, new IssueService(prisma));
    const result = await service.handleSlashCommand({
      command: params.get('command') ?? '/bilinear',
      team_id: teamId,
      text: params.get('text') ?? '',
      user_name: params.get('user_name') ?? 'someone',
    });
    return NextResponse.json(result);
  } catch (err) {
    log.error({ err }, 'Slack slash command failed');
    return NextResponse.json({
      response_type: 'ephemeral',
      text: 'Something went wrong handling that command.',
    });
  }
}

export const POST = withRequestContext('integrations/slack/commands', handlePost);
