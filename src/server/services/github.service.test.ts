import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WORKFLOW_STATES,
  TEST_ISSUE,
  TEST_ORG,
  TEST_TEAM,
  TEST_USER,
} from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { mockSyncActionInserts, readSyncActionInserts } from '../../test/sync-action-mock';
import { redis } from '../lib/redis';
import {
  GitHubIntegrationAlreadyConnectedError,
  GitHubIntegrationNotFoundError,
  GitHubService,
} from './github.service';

// GitHubService, when constructed without explicit deps (the production
// shape — see the two route handlers that do `new GitHubService(prisma)`),
// builds a real SyncService bound to the redis singleton so a PR-merge
// auto-close still gets a genuine SyncAction publish in production. Mock
// the redis module so that publish is a no-op vi.fn() instead of a real
// network call during these unit tests.
vi.mock('../lib/redis', () => ({
  redis: { publish: vi.fn().mockResolvedValue(1) },
}));

const TEST_INTEGRATION = {
  accessToken: 'gho_testtoken',
  createdAt: new Date('2026-04-01T00:00:00Z'),
  createdById: TEST_USER.id,
  githubLogin: 'octocat',
  githubUserId: 583231,
  id: '00000000-0000-0000-0000-000000000700',
  organizationId: TEST_ORG.id,
  updatedAt: new Date('2026-04-01T00:00:00Z'),
  webhookSecret: 'whsecret',
};

/** Build a minimal GitHub `pull_request` webhook payload. */
function buildPrPayload(overrides: {
  action?: string;
  branch?: string;
  merged?: boolean;
  mergedAt?: string;
  closedAt?: string;
  title?: string;
}): Record<string, unknown> {
  return {
    action: overrides.action ?? 'opened',
    pull_request: {
      closed_at: overrides.closedAt ?? null,
      draft: false,
      head: { ref: overrides.branch ?? 'feature-branch' },
      html_url: 'https://github.com/acme/repo/pull/7',
      merged: overrides.merged ?? false,
      merged_at: overrides.mergedAt ?? null,
      number: 7,
      title: overrides.title ?? 'Some change',
      user: { login: 'octocat' },
    },
    repository: { full_name: 'acme/repo' },
  };
}

describe('GitHubService', () => {
  let prisma: MockPrismaClient;
  let service: GitHubService;

  beforeEach(() => {
    prisma = createMockPrisma();
    // Constructed WITHOUT explicit deps, exactly like the two production
    // route handlers — exercises the default-constructed IssueService /
    // SyncService / WebhookService wiring (all bound to this same mock
    // prisma) rather than a test-only shortcut, so these tests actually
    // verify the production DI path.
    service = new GitHubService(prisma as never);

    // Default: no webhook subscribers, so dispatchEvent's fire-and-forget
    // call is a harmless no-op unless a test explicitly cares about it.
    prisma.webhook.findMany.mockResolvedValue([]);

    // recordSyncAction (called via the txHook during auto-close) persists
    // through a raw INSERT ... RETURNING rather than `syncAction.create`.
    mockSyncActionInserts(prisma);

    vi.mocked(redis.publish).mockClear();
  });

  describe('findByOrg', () => {
    it('looks up the integration by organizationId', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);

      const result = await service.findByOrg(TEST_ORG.id);

      expect(result).toEqual(TEST_INTEGRATION);
      expect(prisma.gitHubIntegration.findUnique).toHaveBeenCalledWith({
        where: { organizationId: TEST_ORG.id },
      });
    });
  });

  describe('connect', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
      process.env.GITHUB_CLIENT_ID = 'client-id';
      process.env.GITHUB_CLIENT_SECRET = 'client-secret';
      fetchMock.mockReset();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      delete process.env.GITHUB_CLIENT_ID;
      delete process.env.GITHUB_CLIENT_SECRET;
    });

    it('exchanges the code, fetches the user, and persists the integration', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);
      prisma.gitHubIntegration.create.mockResolvedValue(TEST_INTEGRATION);
      fetchMock
        .mockResolvedValueOnce({
          json: async () => ({
            access_token: 'gho_testtoken',
            scope: 'repo',
            token_type: 'bearer',
          }),
          ok: true,
        })
        .mockResolvedValueOnce({
          json: async () => ({ id: 583231, login: 'octocat' }),
          ok: true,
        });

      const result = await service.connect(TEST_ORG.id, TEST_USER.id, {
        code: 'oauth-code',
        webhookSecret: 'whsecret',
      });

      expect(result).toEqual(TEST_INTEGRATION);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://github.com/login/oauth/access_token',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/user',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer gho_testtoken' }),
        }),
      );
      expect(prisma.gitHubIntegration.create).toHaveBeenCalledWith({
        data: {
          accessToken: 'gho_testtoken',
          createdById: TEST_USER.id,
          githubLogin: 'octocat',
          githubUserId: 583231,
          organizationId: TEST_ORG.id,
          webhookSecret: 'whsecret',
        },
      });
    });

    it('throws when an integration already exists, without calling fetch', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);

      await expect(
        service.connect(TEST_ORG.id, TEST_USER.id, { code: 'c', webhookSecret: 's' }),
      ).rejects.toThrow(GitHubIntegrationAlreadyConnectedError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.gitHubIntegration.create).not.toHaveBeenCalled();
    });

    it('throws when OAuth client env vars are missing', async () => {
      delete process.env.GITHUB_CLIENT_ID;
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);

      await expect(
        service.connect(TEST_ORG.id, TEST_USER.id, { code: 'c', webhookSecret: 's' }),
      ).rejects.toThrow('GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set');
    });

    it('throws when the token exchange returns a non-ok response', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);
      fetchMock.mockResolvedValueOnce({ json: async () => ({}), ok: false, status: 401 });

      await expect(
        service.connect(TEST_ORG.id, TEST_USER.id, { code: 'c', webhookSecret: 's' }),
      ).rejects.toThrow('GitHub token exchange failed: 401');
    });

    it('throws when GitHub returns an OAuth error payload', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);
      fetchMock.mockResolvedValueOnce({
        json: async () => ({ error: 'bad_verification_code' }),
        ok: true,
      });

      await expect(
        service.connect(TEST_ORG.id, TEST_USER.id, { code: 'c', webhookSecret: 's' }),
      ).rejects.toThrow('GitHub OAuth error: bad_verification_code');
    });
  });

  describe('disconnect', () => {
    it('deletes the integration when found', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);
      prisma.gitHubIntegration.delete.mockResolvedValue(TEST_INTEGRATION);

      await service.disconnect(TEST_ORG.id);

      expect(prisma.gitHubIntegration.delete).toHaveBeenCalledWith({
        where: { id: TEST_INTEGRATION.id },
      });
    });

    it('throws when there is no integration', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);

      await expect(service.disconnect(TEST_ORG.id)).rejects.toThrow(GitHubIntegrationNotFoundError);
      expect(prisma.gitHubIntegration.delete).not.toHaveBeenCalled();
    });
  });

  describe('rotateWebhookSecret', () => {
    it('updates the stored secret', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);
      prisma.gitHubIntegration.update.mockResolvedValue({
        ...TEST_INTEGRATION,
        webhookSecret: 'new-secret',
      });

      const result = await service.rotateWebhookSecret(TEST_ORG.id, 'new-secret');

      expect(result.webhookSecret).toBe('new-secret');
      expect(prisma.gitHubIntegration.update).toHaveBeenCalledWith({
        data: { webhookSecret: 'new-secret' },
        where: { id: TEST_INTEGRATION.id },
      });
    });

    it('throws when there is no integration', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);

      await expect(service.rotateWebhookSecret(TEST_ORG.id, 'x')).rejects.toThrow(
        GitHubIntegrationNotFoundError,
      );
    });
  });

  describe('validateWebhookSignature', () => {
    const body = Buffer.from('{"action":"opened"}');

    function sign(secret: string): string {
      return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    }

    it('returns true for a valid signature', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);

      const result = await service.validateWebhookSignature(
        TEST_ORG.id,
        body,
        sign(TEST_INTEGRATION.webhookSecret),
      );

      expect(result).toBe(true);
    });

    it('returns false for a signature computed with the wrong secret', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);

      const result = await service.validateWebhookSignature(TEST_ORG.id, body, sign('wrong'));

      expect(result).toBe(false);
    });

    it('returns false when the signature header is missing', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);

      const result = await service.validateWebhookSignature(TEST_ORG.id, body, null);

      expect(result).toBe(false);
    });

    it('returns false when there is no integration', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);

      const result = await service.validateWebhookSignature(
        TEST_ORG.id,
        body,
        sign(TEST_INTEGRATION.webhookSecret),
      );

      expect(result).toBe(false);
    });
  });

  describe('handlePullRequestEvent', () => {
    beforeEach(() => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(TEST_INTEGRATION);
    });

    it('returns early when there is no integration', async () => {
      prisma.gitHubIntegration.findUnique.mockResolvedValue(null);

      await service.handlePullRequestEvent(TEST_ORG.id, buildPrPayload({ title: 'Fix ENG-1' }));

      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('returns early when the payload has no pull_request', async () => {
      await service.handlePullRequestEvent(TEST_ORG.id, { action: 'opened' });

      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('does nothing when no identifiers are present in title or branch', async () => {
      await service.handlePullRequestEvent(
        TEST_ORG.id,
        buildPrPayload({ branch: 'just-a-branch', title: 'No refs here' }),
      );

      expect(prisma.issue.findMany).not.toHaveBeenCalled();
      expect(prisma.gitHubPullRequest.upsert).not.toHaveBeenCalled();
    });

    it('extracts identifiers from title + branch (deduped, case-insensitive) and queries with the previousIdentifiers fallback', async () => {
      prisma.issue.findMany.mockResolvedValue([]);

      await service.handlePullRequestEvent(
        TEST_ORG.id,
        buildPrPayload({ branch: 'feature/eng-1-thing', title: 'Fix ENG-1 and PLAT-42' }),
      );

      expect(prisma.issue.findMany).toHaveBeenCalledWith({
        select: { id: true, identifier: true, teamId: true },
        where: {
          OR: [
            { identifier: { in: ['ENG-1', 'PLAT-42'] } },
            { previousIdentifiers: { hasSome: ['ENG-1', 'PLAT-42'] } },
          ],
          organizationId: TEST_ORG.id,
        },
      });
    });

    it('does not upsert when no issues match the identifiers', async () => {
      prisma.issue.findMany.mockResolvedValue([]);

      await service.handlePullRequestEvent(TEST_ORG.id, buildPrPayload({ title: 'Fix ENG-999' }));

      expect(prisma.gitHubPullRequest.upsert).not.toHaveBeenCalled();
    });

    it('upserts a PR row for an issue matched via the previousIdentifiers fallback', async () => {
      // Title references the old identifier; the issue's current identifier differs.
      prisma.issue.findMany.mockResolvedValue([
        { id: TEST_ISSUE.id, identifier: 'ENG-1', teamId: TEST_TEAM.id },
      ]);
      prisma.gitHubPullRequest.upsert.mockResolvedValue({});

      await service.handlePullRequestEvent(TEST_ORG.id, buildPrPayload({ title: 'Closes OLD-5' }));

      expect(prisma.gitHubPullRequest.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.gitHubPullRequest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            integrationId: TEST_INTEGRATION.id,
            issueId: TEST_ISSUE.id,
            prNumber: 7,
            repoFullName: 'acme/repo',
            state: 'open',
          }),
          where: {
            integrationId_prNumber_repoFullName_issueId: {
              integrationId: TEST_INTEGRATION.id,
              issueId: TEST_ISSUE.id,
              prNumber: 7,
              repoFullName: 'acme/repo',
            },
          },
        }),
      );
    });

    it('records a closed-but-not-merged PR without auto-closing the issue', async () => {
      prisma.issue.findMany.mockResolvedValue([
        { id: TEST_ISSUE.id, identifier: 'ENG-1', teamId: TEST_TEAM.id },
      ]);
      prisma.gitHubPullRequest.upsert.mockResolvedValue({});

      await service.handlePullRequestEvent(
        TEST_ORG.id,
        buildPrPayload({ action: 'closed', merged: false, title: 'Fix ENG-1' }),
      );

      expect(prisma.gitHubPullRequest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ state: 'closed' }) }),
      );
      // findMany was called once (identifier resolve); no auto-close re-query.
      expect(prisma.issue.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('auto-closes matched issues to the first completed state on merge, emitting a SyncAction and issue.updated webhook', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
      const completedState = DEFAULT_WORKFLOW_STATES[3];

      prisma.issue.findMany
        // identifier resolution
        .mockResolvedValueOnce([{ id: TEST_ISSUE.id, identifier: 'ENG-1', teamId: TEST_TEAM.id }])
        // auto-close re-query (with state + team.workflowStates includes)
        .mockResolvedValueOnce([
          {
            ...TEST_ISSUE,
            state: { type: 'started' },
            team: { ...TEST_TEAM, workflowStates: [completedState] },
          },
        ]);
      prisma.gitHubPullRequest.upsert.mockResolvedValue({});

      // The auto-close now routes through IssueService.update (same path
      // issueUpdate uses), which re-validates the stateId transition and
      // checks the team's cascade flags inside its own transaction.
      prisma.issue.findUnique.mockResolvedValue({
        canceledAt: null,
        completedAt: null,
        startedAt: null,
        stateId: DEFAULT_WORKFLOW_STATES[2].id,
        teamId: TEST_TEAM.id,
      });
      prisma.workflowState.findFirst.mockResolvedValue({
        teamId: TEST_TEAM.id,
        type: 'completed',
      });
      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: false,
        autoCloseParentIssues: false,
      });
      const updatedIssue = {
        ...TEST_ISSUE,
        completedAt: new Date('2026-06-24T12:00:00Z'),
        stateId: completedState.id,
      };
      prisma.issue.update.mockResolvedValue(updatedIssue);
      // `SyncService.recordSyncAction` drops the Yjs `descriptionState` blob
      // from every Issue payload (it replicates over Hocuspocus, not the
      // SyncAction stream), so the recorded payload is the row minus that key.
      const { descriptionState: _descriptionState, ...syncPayload } = updatedIssue;

      await service.handlePullRequestEvent(
        TEST_ORG.id,
        buildPrPayload({
          action: 'closed',
          merged: true,
          mergedAt: '2026-06-24T11:00:00Z',
          title: 'Fix ENG-1',
        }),
      );

      expect(prisma.gitHubPullRequest.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ state: 'merged' }) }),
      );
      expect(prisma.issue.findMany).toHaveBeenNthCalledWith(2, {
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
          id: { in: [TEST_ISSUE.id] },
          organizationId: TEST_ORG.id,
          state: { type: { notIn: ['completed', 'canceled'] } },
        },
      });
      expect(prisma.issue.update).toHaveBeenCalledWith({
        data: {
          canceledAt: null,
          completedAt: new Date('2026-06-24T12:00:00Z'),
          startedAt: null,
          stateId: completedState.id,
        },
        where: { id: TEST_ISSUE.id },
      });

      // Critical fix: a SyncAction must be recorded for the closed issue so
      // delta sync ships the change — before this fix, PR-merge auto-close
      // was a bare prisma write with no SyncAction, and clients showed the
      // issue open forever.
      // `syncPayload`, not `updatedIssue`: `recordSyncAction` strips the Yjs
      // `descriptionState` blob from every Issue payload.
      expect(readSyncActionInserts(prisma)).toContainEqual({
        action: 'U',
        data: JSON.parse(JSON.stringify(syncPayload)),
        modelId: TEST_ISSUE.id,
        modelName: 'Issue',
        organizationId: TEST_ORG.id,
      });
      // ...and published to Redis after the (mocked) transaction commits.
      expect(redis.publish).toHaveBeenCalled();

      // The standard issue.updated webhook fires too.
      expect(prisma.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ events: { has: 'issue.updated' } }),
        }),
      );

      vi.useRealTimers();
    });

    it('fires the parent auto-close cascade (with its own SyncAction) when the team has autoCloseParentIssues enabled', async () => {
      const completedState = DEFAULT_WORKFLOW_STATES[3];
      const parentId = '00000000-0000-0000-0000-000000000401';

      prisma.issue.findMany
        // identifier resolution
        .mockResolvedValueOnce([{ id: TEST_ISSUE.id, identifier: 'ENG-1', teamId: TEST_TEAM.id }])
        // auto-close re-query
        .mockResolvedValueOnce([
          {
            ...TEST_ISSUE,
            parentId,
            state: { type: 'started' },
            team: { ...TEST_TEAM, workflowStates: [completedState] },
          },
        ])
        // maybeCloseParentTx: sibling query — only this child, now completed
        .mockResolvedValueOnce([{ id: TEST_ISSUE.id, state: { type: 'completed' } }]);
      prisma.gitHubPullRequest.upsert.mockResolvedValue({});

      prisma.issue.findUnique
        // stateId-belongs-to-team validation (child's own transition)
        .mockResolvedValueOnce({
          canceledAt: null,
          completedAt: null,
          startedAt: null,
          stateId: DEFAULT_WORKFLOW_STATES[2].id,
          teamId: TEST_TEAM.id,
        })
        // maybeCloseParentTx: parent fetch — not yet done
        .mockResolvedValueOnce({
          id: parentId,
          state: { type: 'started' },
        });

      prisma.workflowState.findFirst
        // stateId-belongs-to-team validation
        .mockResolvedValueOnce({ teamId: TEST_TEAM.id, type: 'completed' })
        // maybeCloseParentTx completed-state lookup
        .mockResolvedValueOnce(completedState);

      prisma.team.findUnique.mockResolvedValue({
        autoCloseChildIssues: false,
        autoCloseParentIssues: true,
      });

      const updatedChild = { ...TEST_ISSUE, parentId, stateId: completedState.id };
      const updatedParent = {
        completedAt: new Date('2026-06-24T12:00:00Z'),
        id: parentId,
        stateId: completedState.id,
        teamId: TEST_TEAM.id,
      };
      prisma.issue.update
        .mockResolvedValueOnce(updatedChild) // child close
        .mockResolvedValueOnce(updatedParent); // cascaded parent close

      await service.handlePullRequestEvent(
        TEST_ORG.id,
        buildPrPayload({ action: 'closed', merged: true, title: 'Fix ENG-1' }),
      );

      // The parent got closed too.
      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: parentId } }),
      );
      // A SyncAction is recorded for BOTH the child and the cascaded
      // parent — without one for the parent, its auto-close would never
      // reach delta sync even though the child's did.
      const inserts = readSyncActionInserts(prisma);
      expect(inserts).toContainEqual(expect.objectContaining({ modelId: TEST_ISSUE.id }));
      expect(inserts).toContainEqual(expect.objectContaining({ modelId: parentId }));
    });

    it('skips auto-close for an issue whose team has no completed state', async () => {
      prisma.issue.findMany
        .mockResolvedValueOnce([{ id: TEST_ISSUE.id, identifier: 'ENG-1', teamId: TEST_TEAM.id }])
        .mockResolvedValueOnce([
          {
            ...TEST_ISSUE,
            state: { type: 'started' },
            team: { ...TEST_TEAM, workflowStates: [] },
          },
        ]);
      prisma.gitHubPullRequest.upsert.mockResolvedValue({});

      await service.handlePullRequestEvent(
        TEST_ORG.id,
        buildPrPayload({ action: 'closed', merged: true, title: 'Fix ENG-1' }),
      );

      expect(prisma.issue.update).not.toHaveBeenCalled();
    });

    it('swallows a per-issue update failure during the auto-close cascade', async () => {
      const completedState = DEFAULT_WORKFLOW_STATES[3];
      prisma.issue.findMany
        .mockResolvedValueOnce([{ id: TEST_ISSUE.id, identifier: 'ENG-1', teamId: TEST_TEAM.id }])
        .mockResolvedValueOnce([
          {
            ...TEST_ISSUE,
            state: { type: 'started' },
            team: { ...TEST_TEAM, workflowStates: [completedState] },
          },
        ]);
      prisma.gitHubPullRequest.upsert.mockResolvedValue({});
      // Validation passes, but the actual write inside IssueService.update's
      // transaction fails ("db down").
      prisma.issue.findUnique.mockResolvedValue({
        canceledAt: null,
        completedAt: null,
        startedAt: null,
        stateId: DEFAULT_WORKFLOW_STATES[2].id,
        teamId: TEST_TEAM.id,
      });
      prisma.workflowState.findFirst.mockResolvedValue({
        teamId: TEST_TEAM.id,
        type: 'completed',
      });
      prisma.issue.update.mockRejectedValue(new Error('db down'));

      await expect(
        service.handlePullRequestEvent(
          TEST_ORG.id,
          buildPrPayload({ action: 'closed', merged: true, title: 'Fix ENG-1' }),
        ),
      ).resolves.toBeUndefined();

      // The failed write must not leak a SyncAction — recordSyncAction only
      // runs (via the txHook) after tx.issue.update succeeds.
      expect(readSyncActionInserts(prisma)).toHaveLength(0);
    });
  });

  describe('getPullRequestsForIssue', () => {
    it('returns PRs for an issue, newest first', async () => {
      const prRow = { id: '00000000-0000-0000-0000-000000000800', issueId: TEST_ISSUE.id };
      prisma.gitHubPullRequest.findMany.mockResolvedValue([prRow]);

      const result = await service.getPullRequestsForIssue(TEST_ISSUE.id);

      expect(result).toEqual([prRow]);
      expect(prisma.gitHubPullRequest.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        where: { issueId: TEST_ISSUE.id },
      });
    });
  });
});
