import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signGithubOAuthState } from '@/server/lib/jwt';

const connect = vi.fn();
const extractAuthContext = vi.fn();
const findMember = vi.fn();
const findOrg = vi.fn();

vi.mock('@/server/config', () => ({ config: {} }));
vi.mock('@/server/lib/env', () => ({ env: { APP_URL: 'https://app.test' } }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: (...a: unknown[]) => findOrg(...a) },
    organizationMember: { findUnique: (...a: unknown[]) => findMember(...a) },
  },
}));
vi.mock('@/server/middleware/auth', () => ({
  extractAuthContext: (...a: unknown[]) => extractAuthContext(...a),
}));
vi.mock('@/server/services/github.service', () => ({
  GitHubService: class {
    connect(...a: unknown[]) {
      return connect(...a);
    }
  },
}));

import { GET } from './route';

async function callbackReq() {
  const state = await signGithubOAuthState({ orgId: 'org-1', userId: 'user-1' });
  return new NextRequest(
    `https://app.test/api/integrations/github/callback?code=abc&state=${state}`,
    { headers: { cookie: 'access_token=t' } },
  );
}

describe('GET /api/integrations/github/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractAuthContext.mockResolvedValue({ orgId: 'org-1', userId: 'user-1' });
    findMember.mockResolvedValue({ role: 'owner' });
    findOrg.mockResolvedValue({ urlKey: 'acme' });
    connect.mockResolvedValue({});
  });

  it('generates a fresh high-entropy webhook secret at connect time, outside any URL', async () => {
    const a = await GET(await callbackReq());
    const b = await GET(await callbackReq());
    const secrets = connect.mock.calls.map(c => (c[2] as { webhookSecret: string }).webhookSecret);
    expect(secrets).toHaveLength(2);
    for (const secret of secrets) {
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
      expect(a.headers.get('location')).not.toContain(secret);
    }
    expect(secrets[0]).not.toBe(secrets[1]);
    expect(a.headers.get('location')).toContain('/acme/settings/integrations?connected=1');
  });
});
