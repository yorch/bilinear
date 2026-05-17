import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GitHubIntegration, GitHubPullRequest, PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'github' });

// Regex that matches issue identifiers like ENG-123, PLAT-42, etc.
const IDENTIFIER_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

export class GitHubIntegrationNotFoundError extends Error {
  constructor() {
    super('GitHub integration not found');
    this.name = 'GitHubIntegrationNotFoundError';
  }
}

export class GitHubIntegrationAlreadyConnectedError extends Error {
  constructor() {
    super('A GitHub integration is already connected to this workspace');
    this.name = 'GitHubIntegrationAlreadyConnectedError';
  }
}

export interface GitHubConnectInput {
  /** OAuth code from the GitHub callback */
  code: string;
  /** Webhook secret that the user will configure in GitHub webhook settings */
  webhookSecret: string;
}

interface GitHubTokenResponse {
  access_token: string;
  scope: string;
  token_type: string;
}

interface GitHubUser {
  id: number;
  login: string;
}

export class GitHubService {
  constructor(private prisma: PrismaClient) {}

  async findByOrg(orgId: string): Promise<GitHubIntegration | null> {
    return this.prisma.gitHubIntegration.findUnique({ where: { organizationId: orgId } });
  }

  async connect(
    orgId: string,
    userId: string,
    input: GitHubConnectInput,
  ): Promise<GitHubIntegration> {
    const existing = await this.findByOrg(orgId);
    if (existing) {
      throw new GitHubIntegrationAlreadyConnectedError();
    }

    const tokenData = await exchangeCodeForToken(input.code);
    const ghUser = await fetchGitHubUser(tokenData.access_token);

    return this.prisma.gitHubIntegration.create({
      data: {
        accessToken: tokenData.access_token,
        createdById: userId,
        githubLogin: ghUser.login,
        githubUserId: ghUser.id,
        organizationId: orgId,
        webhookSecret: input.webhookSecret,
      },
    });
  }

  async disconnect(orgId: string): Promise<void> {
    const integration = await this.findByOrg(orgId);
    if (!integration) {
      throw new GitHubIntegrationNotFoundError();
    }
    await this.prisma.gitHubIntegration.delete({ where: { id: integration.id } });
  }

  /** Update the stored webhook secret (e.g. after rotating in GitHub settings). */
  async rotateWebhookSecret(orgId: string, newSecret: string): Promise<GitHubIntegration> {
    const integration = await this.findByOrg(orgId);
    if (!integration) {
      throw new GitHubIntegrationNotFoundError();
    }
    return this.prisma.gitHubIntegration.update({
      data: { webhookSecret: newSecret },
      where: { id: integration.id },
    });
  }

  /**
   * Validate a GitHub webhook request's HMAC-SHA256 signature.
   * Returns true if the signature matches the stored secret.
   */
  async validateWebhookSignature(
    orgId: string,
    rawBody: Buffer,
    signatureHeader: string | null,
  ): Promise<boolean> {
    const integration = await this.findByOrg(orgId);
    if (!integration) {
      return false;
    }
    return verifySignature(rawBody, integration.webhookSecret, signatureHeader);
  }

  /**
   * Process a GitHub `pull_request` event payload:
   * - extract issue identifiers from PR title + head branch
   * - upsert GitHubPullRequest rows for each matched issue
   * - auto-close issues on PR merge (transitions to first completed state)
   */
  async handlePullRequestEvent(
    orgId: string,
    // biome-ignore lint/suspicious/noExplicitAny: GitHub webhook payload
    payload: Record<string, any>,
  ): Promise<void> {
    const integration = await this.findByOrg(orgId);
    if (!integration) {
      log.warn({ orgId }, 'handlePullRequestEvent: no integration found');
      return;
    }

    const pr = payload.pull_request;
    if (!pr) {
      return;
    }

    const action: string = payload.action;
    const repoFullName: string = payload.repository?.full_name ?? '';
    const prNumber: number = pr.number;
    const title: string = pr.title ?? '';
    const url: string = pr.html_url ?? '';
    const headBranch: string = pr.head?.ref ?? '';
    const draft: boolean = pr.draft ?? false;
    const authorLogin: string = pr.user?.login ?? '';

    let state: 'open' | 'closed' | 'merged' = 'open';
    let mergedAt: Date | null = null;
    let closedAt: Date | null = null;

    if (action === 'closed') {
      if (pr.merged) {
        state = 'merged';
        mergedAt = pr.merged_at ? new Date(pr.merged_at) : new Date();
      } else {
        state = 'closed';
        closedAt = pr.closed_at ? new Date(pr.closed_at) : new Date();
      }
    }

    // Collect unique identifiers from title + branch
    const identifiers = extractIdentifiers(`${title} ${headBranch}`);
    if (identifiers.length === 0) {
      log.debug({ headBranch, orgId, prNumber, title }, 'No issue identifiers found in PR');
      return;
    }

    // Resolve identifiers → issue IDs
    const issues = await this.prisma.issue.findMany({
      select: { id: true, identifier: true, teamId: true },
      where: {
        identifier: { in: identifiers },
        organizationId: orgId,
      },
    });

    if (issues.length === 0) {
      log.debug({ identifiers, orgId }, 'No matching issues found for PR identifiers');
      return;
    }

    // Upsert a GitHubPullRequest row per matched issue
    await Promise.all(
      issues.map(issue =>
        this.prisma.gitHubPullRequest.upsert({
          create: {
            authorLogin,
            closedAt,
            draft,
            headBranch,
            integrationId: integration.id,
            issueId: issue.id,
            mergedAt,
            organizationId: orgId,
            prNumber,
            repoFullName,
            state,
            title,
            url,
          },
          update: {
            authorLogin,
            closedAt,
            draft,
            mergedAt,
            state,
            title,
          },
          where: {
            integrationId_prNumber_repoFullName: {
              integrationId: integration.id,
              prNumber,
              repoFullName,
            },
          },
        }),
      ),
    );

    log.info({ identifiers: issues.map(i => i.identifier), orgId, prNumber, state }, 'PR linked');

    // Auto-close issues when PR merges
    if (state === 'merged') {
      await this.autoCloseIssuesOnMerge(
        orgId,
        issues.map(i => i.id),
      );
    }
  }

  /** Transition issues to their team's first completed workflow state on merge. */
  private async autoCloseIssuesOnMerge(orgId: string, issueIds: string[]): Promise<void> {
    const issues = await this.prisma.issue.findMany({
      include: {
        state: true,
        team: {
          include: {
            workflowStates: {
              orderBy: { position: 'asc' },
              where: { type: 'completed' },
            },
          },
        },
      },
      where: {
        id: { in: issueIds },
        organizationId: orgId,
        // Only auto-close non-completed issues
        state: { type: { notIn: ['completed', 'canceled'] } },
      },
    });

    for (const issue of issues) {
      const completedState = issue.team.workflowStates[0];
      if (!completedState) {
        continue;
      }
      try {
        await this.prisma.issue.update({
          data: {
            completedAt: new Date(),
            stateId: completedState.id,
          },
          where: { id: issue.id },
        });
        log.info({ identifier: issue.identifier, orgId }, 'Auto-closed issue on PR merge');
      } catch (err) {
        log.error({ err, issueId: issue.id }, 'Failed to auto-close issue on PR merge');
      }
    }
  }

  async getPullRequestsForIssue(issueId: string): Promise<GitHubPullRequest[]> {
    return this.prisma.gitHubPullRequest.findMany({
      orderBy: { createdAt: 'desc' },
      where: { issueId },
    });
  }
}

// ---------------------------------------------------------------------------
// GitHub OAuth helpers
// ---------------------------------------------------------------------------

async function exchangeCodeForToken(code: string): Promise<GitHubTokenResponse> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set');
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code }),
    headers: { Accept: 'application/json' },
    method: 'POST',
  });

  if (!res.ok) {
    throw new Error(`GitHub token exchange failed: ${res.status}`);
  }

  const data = (await res.json()) as GitHubTokenResponse & { error?: string };
  if (data.error) {
    throw new Error(`GitHub OAuth error: ${data.error}`);
  }
  return data;
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub user fetch failed: ${res.status}`);
  }
  return res.json() as Promise<GitHubUser>;
}

function verifySignature(body: Buffer, secret: string, header: string | null): boolean {
  if (!header) {
    return false;
  }
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(header, 'utf8'));
  } catch {
    return false;
  }
}

function extractIdentifiers(text: string): string[] {
  const matches = text.toUpperCase().match(IDENTIFIER_RE);
  return matches ? [...new Set(matches)] : [];
}
