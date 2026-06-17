import crypto from 'node:crypto';
import type { PrismaClient, SlackIntegration } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import type { IssueService } from './issue.service';

const log = childLogger({ module: 'slack' });

// Reject slash requests whose timestamp is older than this (replay defence),
// per Slack's guidance.
const MAX_REQUEST_AGE_SECONDS = 60 * 5;

export class SlackIntegrationNotFoundError extends Error {
  constructor() {
    super('Slack integration not found');
    this.name = 'SlackIntegrationNotFoundError';
  }
}

export interface SlackConnectInput {
  accessToken: string;
  botUserId: string;
  slackTeamId: string;
  slackTeamName: string;
}

export interface SlackOAuthResponse {
  access_token?: string;
  bot_user_id?: string;
  error?: string;
  ok: boolean;
  team?: { id?: string; name?: string };
}

/** Parsed slash-command form payload (application/x-www-form-urlencoded). */
export interface SlackSlashPayload {
  command: string;
  team_id: string;
  text: string;
  user_name: string;
}

export class SlackService {
  constructor(
    private prisma: PrismaClient,
    private issueService: IssueService,
  ) {}

  findByOrg(orgId: string): Promise<SlackIntegration | null> {
    return this.prisma.slackIntegration.findUnique({ where: { organizationId: orgId } });
  }

  async connect(
    orgId: string,
    userId: string,
    input: SlackConnectInput,
  ): Promise<SlackIntegration> {
    // Upsert so reconnecting (e.g. token refresh / re-auth) updates in place.
    // Also detach any other org that previously claimed this Slack workspace.
    await this.prisma.slackIntegration.deleteMany({
      where: { organizationId: { not: orgId }, slackTeamId: input.slackTeamId },
    });
    return this.prisma.slackIntegration.upsert({
      create: {
        accessToken: input.accessToken,
        botUserId: input.botUserId,
        createdById: userId,
        organizationId: orgId,
        slackTeamId: input.slackTeamId,
        slackTeamName: input.slackTeamName,
      },
      update: {
        accessToken: input.accessToken,
        botUserId: input.botUserId,
        slackTeamName: input.slackTeamName,
      },
      where: { organizationId: orgId },
    });
  }

  async disconnect(orgId: string): Promise<void> {
    await this.prisma.slackIntegration.deleteMany({ where: { organizationId: orgId } });
  }

  async setDefaultTeam(orgId: string, teamId: string | null): Promise<SlackIntegration> {
    const existing = await this.findByOrg(orgId);
    if (!existing) {
      throw new SlackIntegrationNotFoundError();
    }
    return this.prisma.slackIntegration.update({
      data: { defaultTeamId: teamId },
      where: { organizationId: orgId },
    });
  }

  /**
   * Verify a Slack request signature. base string is `v0:<ts>:<rawBody>`,
   * HMAC-SHA256 with the app signing secret, compared to the `v0=` header.
   * Rejects stale timestamps to bound replay. Uses the global
   * SLACK_SIGNING_SECRET (the signing secret is app-level, not per-install).
   */
  static verifySlashSignature(
    rawBody: string,
    timestamp: string | null,
    signature: string | null,
    signingSecret: string | undefined,
  ): boolean {
    if (!signingSecret || !timestamp || !signature) {
      return false;
    }
    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_REQUEST_AGE_SECONDS) {
      return false;
    }
    const base = `v0:${timestamp}:${rawBody}`;
    const expected = `v0=${crypto.createHmac('sha256', signingSecret).update(base).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Handle a `/bilinear <title>` slash command: create an issue in the org's
   * configured default team and return a Slack-formatted response. The issue
   * is attributed to the admin who connected the integration (no Slack↔app
   * user mapping in this version).
   */
  async handleSlashCommand(
    payload: SlackSlashPayload,
  ): Promise<{ text: string; response_type: 'ephemeral' | 'in_channel' }> {
    const integration = await this.prisma.slackIntegration.findUnique({
      where: { slackTeamId: payload.team_id },
    });
    if (!integration) {
      return { response_type: 'ephemeral', text: 'This Slack workspace is not connected.' };
    }
    if (!integration.defaultTeamId) {
      return {
        response_type: 'ephemeral',
        text: 'No default team is configured. Ask an admin to set one in Settings → Integrations.',
      };
    }
    const title = payload.text.trim();
    if (!title) {
      return { response_type: 'ephemeral', text: 'Usage: `/bilinear <issue title>`' };
    }
    try {
      const issue = await this.issueService.create(
        integration.organizationId,
        integration.createdById,
        {
          description: `Created from Slack by @${payload.user_name}`,
          teamId: integration.defaultTeamId,
          title,
        },
      );
      return { response_type: 'in_channel', text: `Created *${issue.identifier}*: ${issue.title}` };
    } catch (err) {
      log.error({ err }, 'Slack slash command issue create failed');
      return { response_type: 'ephemeral', text: 'Could not create the issue. Try again.' };
    }
  }
}

/** Exchange an OAuth code for a bot token via Slack's oauth.v2.access. */
export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<SlackOAuthResponse> {
  const clientId = process.env.SLACK_CLIENT_ID ?? '';
  const clientSecret = process.env.SLACK_CLIENT_SECRET ?? '';
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  return (await res.json()) as SlackOAuthResponse;
}
