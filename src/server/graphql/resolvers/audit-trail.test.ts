import { describe, expect, it, vi } from 'vitest';
import type { GraphQLContext } from '../context';
import { auditLogResolvers } from './audit-log';
import { githubResolvers } from './github';

const SECRET = 'whsec_super_secret_value_0123456789abcdef';

function ctx(over: Record<string, unknown> = {}) {
  const log = vi.fn().mockResolvedValue(undefined);
  const services = {
    auditLog: {
      exportCsv: vi.fn().mockResolvedValue({ csv: 'x', rows: 3, truncated: true }),
      findByOrg: vi.fn(),
      log,
    },
    github: {
      findByOrg: vi.fn().mockResolvedValue({ id: 'gh-1', webhookSecret: SECRET }),
      rotateWebhookSecret: vi.fn().mockResolvedValue({ id: 'gh-1' }),
    },
  };
  return {
    ctx: {
      clientIp: '10.0.0.1',
      orgId: 'org-1',
      orgRole: 'admin',
      services,
      userId: 'user-1',
      ...over,
    } as unknown as GraphQLContext,
    log,
    services,
  };
}

describe('audit entries for secret-bearing and export operations', () => {
  it('githubRevealWebhookSecret is audited without recording the secret', async () => {
    const { ctx: c, log } = ctx();
    const res = await githubResolvers.Mutation.githubRevealWebhookSecret(undefined, undefined, c);
    expect(res.webhookSecret).toBe(SECRET);
    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      action: 'github.webhook_secret_revealed',
      orgId: 'org-1',
      resourceId: 'gh-1',
      userId: 'user-1',
    });
    expect(JSON.stringify(entry)).not.toContain(SECRET);
  });

  it('githubRotateWebhookSecret is audited without recording the new secret', async () => {
    const { ctx: c, log } = ctx();
    const res = await githubResolvers.Mutation.githubRotateWebhookSecret(
      undefined,
      { newSecret: null },
      c,
    );
    expect(res.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    const entry = log.mock.calls[0]?.[0];
    expect(entry.action).toBe('github.webhook_secret_rotated');
    expect(entry.metadata).toEqual({ generated: true });
    expect(JSON.stringify(entry)).not.toContain(res.webhookSecret as string);

    log.mockClear();
    const supplied = 'x'.repeat(24);
    await githubResolvers.Mutation.githubRotateWebhookSecret(undefined, { newSecret: supplied }, c);
    expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain(supplied);
  });

  it('a failed reveal writes no audit entry', async () => {
    const { ctx: c, log, services } = ctx();
    services.github.findByOrg.mockResolvedValue(null);
    await expect(
      githubResolvers.Mutation.githubRevealWebhookSecret(undefined, undefined, c),
    ).rejects.toThrow();
    expect(log).not.toHaveBeenCalled();
  });

  it('auditLogExport records who exported, filters and row count (not content)', async () => {
    const { ctx: c, log } = ctx();
    await auditLogResolvers.Query.auditLogExport(
      undefined,
      { filter: { action: 'issue.created', orgId: 'x' } },
      c,
    );
    const entry = log.mock.calls[0]?.[0];
    expect(entry).toMatchObject({ action: 'audit_log.exported', orgId: 'org-1', userId: 'user-1' });
    expect(entry.metadata).toMatchObject({
      filterAction: 'issue.created',
      rows: 3,
      truncated: true,
    });
    expect(JSON.stringify(entry)).not.toContain('"csv"');
  });

  it('auditLogs maps a malformed cursor to BAD_USER_INPUT, not an internal error', async () => {
    const { ctx: c, services } = ctx();
    const { InvalidCursorError } = await import('../../lib/created-at-cursor');
    services.auditLog.findByOrg.mockRejectedValue(new InvalidCursorError());
    await expect(
      auditLogResolvers.Query.auditLogs(
        undefined,
        { filter: { cursor: '2026-01-01T00:00:00Z|notauuid', orgId: 'x' } },
        c,
      ),
    ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
  });
});
