import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAuthContext = vi.fn();
const findMember = vi.fn();

vi.mock('@/server/lib/env', () => ({ env: { APP_URL: 'https://app.test' } }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: { organizationMember: { findUnique: (...a: unknown[]) => findMember(...a) } },
}));
vi.mock('@/server/middleware/auth', () => ({
  requireAuthContext: (...a: unknown[]) => requireAuthContext(...a),
}));

import { verifyGithubOAuthState } from '@/server/lib/jwt';
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

  // Real signState/verifyState and real crypto: the state is HS256-signed but
  // NOT encrypted, so anything put in it is readable by whoever sees the URL.
  it('puts no secret in the OAuth state or in any URL it redirects to', async () => {
    const res = await GET(req('?webhookSecret=attacker-chosen-secret-123'));
    expect(res.status).toBe(307);
    const location = res.headers.get('location') ?? '';
    const state = new URL(location).searchParams.get('state') ?? '';

    // Decode the JWT payload exactly as anyone holding the URL could.
    const claims = JSON.parse(Buffer.from(state.split('.')[1] ?? '', 'base64url').toString());
    expect(Object.keys(claims).sort()).toEqual(
      ['exp', 'iat', 'orgId', 'provider', 'type', 'userId'].sort(),
    );
    expect(JSON.stringify(claims)).not.toMatch(/[0-9a-f]{32,}/);
    expect(location).not.toContain('attacker-chosen');
    expect(location).not.toContain('webhookSecret');
    // The verifier still accepts it and yields only identity.
    await expect(verifyGithubOAuthState(state)).resolves.toEqual({
      orgId: 'org-1',
      userId: 'user-1',
    });
  });
});
