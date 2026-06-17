import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_TEAM, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { SlackService } from './slack.service';

const SIGNING_SECRET = 'shhh-signing-secret';

function signedRequest(body: string, ts = Math.floor(Date.now() / 1000).toString()) {
  const base = `v0:${ts}:${body}`;
  const sig = `v0=${crypto.createHmac('sha256', SIGNING_SECRET).update(base).digest('hex')}`;
  return { sig, ts };
}

describe('SlackService.verifySlashSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const body = 'team_id=T1&text=hi';
    const { sig, ts } = signedRequest(body);
    expect(SlackService.verifySlashSignature(body, ts, sig, SIGNING_SECRET)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const { sig, ts } = signedRequest('team_id=T1&text=hi');
    expect(
      SlackService.verifySlashSignature('team_id=T1&text=HACKED', ts, sig, SIGNING_SECRET),
    ).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const oldTs = (Math.floor(Date.now() / 1000) - 6000).toString();
    const body = 'team_id=T1';
    const { sig } = signedRequest(body, oldTs);
    expect(SlackService.verifySlashSignature(body, oldTs, sig, SIGNING_SECRET)).toBe(false);
  });

  it('rejects when the signing secret is missing', () => {
    const body = 'team_id=T1';
    const { sig, ts } = signedRequest(body);
    expect(SlackService.verifySlashSignature(body, ts, sig, undefined)).toBe(false);
  });
});

describe('SlackService.handleSlashCommand', () => {
  let prisma: MockPrismaClient;
  let issueService: { create: ReturnType<typeof vi.fn> };
  let svc: SlackService;

  beforeEach(() => {
    prisma = createMockPrisma();
    issueService = { create: vi.fn() };
    svc = new SlackService(prisma as never, issueService as never);
  });

  const payload = (text: string) => ({
    command: '/bilinear',
    team_id: 'T-slack',
    text,
    user_name: 'jane',
  });

  it('creates an issue in the default team and confirms in-channel', async () => {
    prisma.slackIntegration.findUnique.mockResolvedValue({
      createdById: TEST_USER.id,
      defaultTeamId: TEST_TEAM.id,
      organizationId: TEST_ORG.id,
      slackTeamId: 'T-slack',
    });
    issueService.create.mockResolvedValue({ identifier: 'ENG-9', title: 'Fix it' });

    const res = await svc.handleSlashCommand(payload('Fix it'));

    expect(issueService.create).toHaveBeenCalledWith(
      TEST_ORG.id,
      TEST_USER.id,
      expect.objectContaining({ teamId: TEST_TEAM.id, title: 'Fix it' }),
    );
    expect(res.response_type).toBe('in_channel');
    expect(res.text).toContain('ENG-9');
  });

  it('returns an error when the workspace is not connected', async () => {
    prisma.slackIntegration.findUnique.mockResolvedValue(null);
    const res = await svc.handleSlashCommand(payload('hi'));
    expect(res.response_type).toBe('ephemeral');
    expect(issueService.create).not.toHaveBeenCalled();
  });

  it('asks for a default team when none is configured', async () => {
    prisma.slackIntegration.findUnique.mockResolvedValue({
      createdById: TEST_USER.id,
      defaultTeamId: null,
      organizationId: TEST_ORG.id,
      slackTeamId: 'T-slack',
    });
    const res = await svc.handleSlashCommand(payload('hi'));
    expect(res.text).toMatch(/default team/i);
    expect(issueService.create).not.toHaveBeenCalled();
  });

  it('rejects an empty title with usage help', async () => {
    prisma.slackIntegration.findUnique.mockResolvedValue({
      createdById: TEST_USER.id,
      defaultTeamId: TEST_TEAM.id,
      organizationId: TEST_ORG.id,
      slackTeamId: 'T-slack',
    });
    const res = await svc.handleSlashCommand(payload('   '));
    expect(res.text).toMatch(/Usage/);
    expect(issueService.create).not.toHaveBeenCalled();
  });
});
