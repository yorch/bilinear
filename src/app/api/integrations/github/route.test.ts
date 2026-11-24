import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signState = vi.fn(async (_payload: unknown) => 'signed-state');
const requireAuthContext = vi.fn();
const findMember = vi.fn();

vi.mock('@/server/lib/env', () => ({ env: { APP_URL: 'https://app.test' } }));
vi.mock('@/server/lib/jwt', () => ({
  signGithubOAuthState: (payload: unknown) => signState(payload),
}));
vi.mock('@/server/lib/prisma', () => ({
  prisma: { organizationMember: { findUnique: (...a: unknown[]) => findMember(...a) } },
}));
vi.mock('@/server/middleware/auth', () => ({
  requireAuthContext: (...a: unknown[]) => requireAuthContext(...a),
}));

import { GET } from './route';

function req(query = '') {
  return new NextRequest(`https://app.test/api/integrations/github${query}`);
}

describe('GET /api/integrations/github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_CLIENT_ID', 'client-id');
    requireAuthContext.mockResolvedValue({ ctx: { orgId: 'org-1', userId: 'user-1' } });
    findMember.mockResolvedValue({ role: 'admin' });
  });

  it('answers 503 when GitHub OAuth is not configured', async () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it('rejects non-admins', async () => {
    findMember.mockResolvedValue({ role: 'member' });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('generates a strong webhook secret server-side and carries it only in the signed state', async () => {
    const res = await GET(req());
    expect(res.status).toBe(307);
    expect(signState).toHaveBeenCalledTimes(1);
    const payload = signState.mock.calls[0]?.[0] as { webhookSecret: string };
    expect(payload.webhookSecret).toMatch(/^[0-9a-f]{64}$/);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('state=signed-state');
    expect(location).not.toContain(payload.webhookSecret);
  });

  it('ignores a webhookSecret supplied in the query string', async () => {
    await GET(req('?webhookSecret=attacker-chosen-secret-123'));
    const payload = signState.mock.calls[0]?.[0] as { webhookSecret: string };
    expect(payload.webhookSecret).not.toBe('attacker-chosen-secret-123');
    expect(payload.webhookSecret).toHaveLength(64);
  });

  it('mints a different secret on every initiation', async () => {
    await GET(req());
    await GET(req());
    const secrets = signState.mock.calls.map(
      c => (c[0] as { webhookSecret: string }).webhookSecret,
    );
    expect(secrets).toHaveLength(2);
    expect(new Set(secrets).size).toBe(2);
  });
});
