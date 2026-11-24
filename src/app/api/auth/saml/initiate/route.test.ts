import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOrg = vi.fn();
const getConfig = vi.fn();
const checkFixedWindow = vi.fn();

vi.mock('@/server/lib/env', () => ({ env: { APP_URL: 'https://app.test' } }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: { organization: { findUnique: (...a: unknown[]) => findOrg(...a) } },
}));
vi.mock('@/server/lib/request-context', () => ({
  bindRequestContext: vi.fn(),
  withRequestContext: (_name: string, fn: unknown) => fn,
}));
let trustedIp: string | null = '203.0.113.9';
vi.mock('@/server/lib/request-security', () => ({
  rateLimitKeyIp: () =>
    trustedIp ? { ip: trustedIp, known: true } : { ip: 'unknown-ip', known: false },
}));
vi.mock('@/server/middleware/rate-limit', () => ({
  checkFixedWindow: (...a: unknown[]) => checkFixedWindow(...a),
}));
vi.mock('@/server/services/saml.service', () => ({
  SamlService: class {
    getConfig(...a: unknown[]) {
      return getConfig(...a);
    }
    buildAuthnRequest() {
      return 'https://idp.test/sso?SAMLRequest=x';
    }
  },
}));

import { GET } from './route';

const req = (qs: string) =>
  new NextRequest(`https://app.test/api/auth/saml/initiate?${qs}`) as NextRequest;

describe('GET /api/auth/saml/initiate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trustedIp = '203.0.113.9';
    checkFixedWindow.mockResolvedValue({ count: 1, exceeded: false });
  });

  async function outcome(qs: string, org: unknown, config: unknown) {
    findOrg.mockResolvedValue(org);
    getConfig.mockResolvedValue(config);
    const res = await GET(req(qs));
    return { body: await res.text(), location: res.headers.get('location'), status: res.status };
  }

  it('answers unknown, unconfigured and disabled workspaces identically (probe)', async () => {
    const unknown = await outcome('org=ghost&probe=1', null, null);
    const unconfigured = await outcome('org=acme&probe=1', { id: 'o1' }, null);
    const disabled = await outcome('org=acme&probe=1', { id: 'o1' }, { enabled: false });
    expect(unknown.status).toBe(404);
    expect(unconfigured).toEqual(unknown);
    expect(disabled).toEqual(unknown);
  });

  it('redirects a plain navigation to /login?sso=unavailable for every failure class', async () => {
    const results = [
      await outcome('org=ghost', null, null),
      await outcome('org=acme', { id: 'o1' }, null),
      await outcome('org=acme', { id: 'o1' }, { enabled: false }),
      await outcome('', null, null),
    ];
    for (const r of results) {
      expect(r.status).toBe(302);
      expect(r.location).toBe('https://app.test/login?sso=unavailable');
    }
  });

  it('does not let a miss skip the config lookup or the latency floor', async () => {
    const started = Date.now();
    await outcome('org=ghost&probe=1', null, null);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it('still redirects an enabled workspace to the IdP', async () => {
    const r = await outcome(
      'org=acme&probe=1',
      { id: 'o1' },
      {
        emailAttribute: 'email',
        enabled: true,
        idpCert: 'c',
        idpEntityId: 'i',
        idpSsoUrl: 'https://idp.test/sso',
        jitProvisioning: false,
        nameAttribute: 'name',
      },
    );
    expect(r.status).toBe(302);
    expect(r.location).toContain('https://idp.test/sso');
  });

  it('rate-limits per IP', async () => {
    checkFixedWindow.mockResolvedValue({ count: 99, exceeded: true });
    const res = await GET(req('org=acme&probe=1'));
    expect(res.status).toBe(429);
    expect(checkFixedWindow).toHaveBeenCalledWith('rl:saml-initiate:203.0.113.9', 20, 60);
    expect(findOrg).not.toHaveBeenCalled();
  });

  it('still rate-limits when the client IP is unknown (no TRUST_PROXY_HEADERS)', async () => {
    trustedIp = null;
    // Real fixed-window semantics over an in-memory counter.
    let count = 0;
    checkFixedWindow.mockImplementation(async (_k: string, limit: number) => ({
      count: ++count,
      exceeded: count > limit,
    }));
    findOrg.mockResolvedValue({ id: 'o1' });
    getConfig.mockResolvedValue({
      emailAttribute: 'email',
      enabled: true,
      idpCert: 'c',
      idpEntityId: 'i',
      idpSsoUrl: 'https://idp.test/sso',
      nameAttribute: 'name',
    });
    const statuses: number[] = [];
    for (let i = 0; i < 125; i++) {
      statuses.push((await GET(req('org=acme&probe=1'))).status);
    }
    expect(checkFixedWindow).toHaveBeenCalledWith('rl:saml-initiate:unknown-ip', 120, 60);
    expect(statuses.filter(s => s === 429)).toHaveLength(5);
    expect(statuses.slice(0, 120).every(s => s === 302)).toBe(true);
  });
});
