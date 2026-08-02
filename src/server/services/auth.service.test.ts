import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  signGithubOAuthState,
  signOAuthState,
  signRefreshToken,
  verifyOAuthState,
} from '../lib/jwt';
import { AuthService, apiScopesAllowWrite, InvalidTokenError } from './auth.service';
import { UserService } from './user.service';

const FAMILY_ID = '00000000-0000-0000-0000-000000000aaa';
const TOKEN_ID = '00000000-0000-0000-0000-000000000bbb';

function makeTokenRow(
  overrides: Partial<{
    familyId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
    organizationId: string | null;
  }> = {},
) {
  return {
    createdAt: new Date('2026-04-22T10:00:00Z'),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    familyId: FAMILY_ID,
    id: TOKEN_ID,
    ipAddress: null,
    label: null,
    lastUsedAt: null,
    organizationId: null,
    revokedAt: null,
    tokenHash: '',
    type: 'refresh' as const,
    userAgent: null,
    userId: TEST_USER.id,
    ...overrides,
  };
}

async function signValidRefreshToken() {
  return signRefreshToken({ tokenId: TOKEN_ID, userId: TEST_USER.id });
}

describe('AuthService.refreshTokens — family + reuse detection', () => {
  let prisma: MockPrismaClient;
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    const userService = new UserService(prisma as never);
    // Avoid the real DB lookup for user → org
    vi.spyOn(userService, 'getOrganizationForUser').mockResolvedValue(null);
    service = new AuthService(prisma as never, userService);
  });

  it('rotates within the same family when the token is in the grace window', async () => {
    const rawToken = await signValidRefreshToken();
    // revokedAt = 10 min in the future (within the 30-min grace window)
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({ revokedAt: new Date(Date.now() + 10 * 60 * 1000) }),
    );
    prisma.authToken.update.mockResolvedValue({});
    prisma.authToken.create.mockResolvedValue({});

    const result = await service.refreshTokens(rawToken);

    expect(result.success).toBe(true);
    // New refresh row inherits the existing family id
    expect(prisma.authToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ familyId: FAMILY_ID, type: 'refresh' }),
      }),
    );
    // No family revoke on a normal rotation
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it('revokes the whole family when a token is replayed after the grace window', async () => {
    const rawToken = await signValidRefreshToken();
    // revokedAt is in the past → this is a post-grace replay (reuse)
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({ revokedAt: new Date(Date.now() - 60 * 1000) }),
    );
    prisma.authToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(InvalidTokenError);

    // Every active descendant of the family revoked in one sweep
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          familyId: FAMILY_ID,
          revokedAt: null,
          type: 'refresh',
        }),
      }),
    );
    // No new token issued
    expect(prisma.authToken.create).not.toHaveBeenCalled();
    // The presented token itself isn't re-revoked individually
    expect(prisma.authToken.update).not.toHaveBeenCalled();
  });

  it('rejects reuse without calling updateMany when the token pre-dates the family migration', async () => {
    const rawToken = await signValidRefreshToken();
    // Legacy token issued before the family_id migration
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({
        familyId: null,
        revokedAt: new Date(Date.now() - 60 * 1000),
      }),
    );

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(InvalidTokenError);

    // Nothing to sweep — the legacy token has no family to kill
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('rejects natural expiry without revoking the family', async () => {
    const rawToken = await signValidRefreshToken();
    // expiresAt in the past → natural 30-day expiry, not reuse
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({
        expiresAt: new Date(Date.now() - 60 * 1000),
        revokedAt: null,
      }),
    );

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(InvalidTokenError);

    // Family stays alive — natural expiry on one token isn't an attack signal
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('rejects unknown token IDs without touching the family', async () => {
    const rawToken = await signValidRefreshToken();
    prisma.authToken.findFirst.mockResolvedValue(null);

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(InvalidTokenError);

    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed refresh JWT', async () => {
    await expect(service.refreshTokens('not-a-real-jwt')).rejects.toBeInstanceOf(InvalidTokenError);

    expect(prisma.authToken.findFirst).not.toHaveBeenCalled();
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService — API token scopes & expiry', () => {
  let prisma: MockPrismaClient;
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new AuthService(prisma as never, new UserService(prisma as never));
    prisma.authToken.create.mockImplementation(async ({ data }: { data: unknown }) => data);
  });

  it('defaults to [read, write] scopes and a 1-year expiry', async () => {
    const before = Date.now();
    const { token } = await service.createApiToken(TEST_USER.id, TEST_ORG.id, 'CI');
    const created = prisma.authToken.create.mock.calls[0]?.[0]?.data as {
      scopes: string[];
      expiresAt: Date;
    };
    expect(created.scopes).toEqual(['read', 'write']);
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    expect(created.expiresAt.getTime()).toBeGreaterThanOrEqual(before + yearMs - 5000);
    expect(token).toBeDefined();
  });

  it('honours an explicit read-only scope and custom expiry', async () => {
    await service.createApiToken(TEST_USER.id, TEST_ORG.id, 'readonly', {
      expiresInDays: 30,
      scopes: ['read'],
    });
    const created = prisma.authToken.create.mock.calls[0]?.[0]?.data as { scopes: string[] };
    expect(created.scopes).toEqual(['read']);
  });

  it('rejects unrecognised scopes and out-of-range expiry', async () => {
    await expect(
      service.createApiToken(TEST_USER.id, TEST_ORG.id, 'bad', { scopes: ['admin'] }),
    ).rejects.toThrow(/Invalid scope/);
    await expect(
      service.createApiToken(TEST_USER.id, TEST_ORG.id, 'bad', { expiresInDays: 99999 }),
    ).rejects.toThrow(/expiresInDays/);
  });

  it('apiScopesAllowWrite: empty (legacy) = full access; read-only blocks writes', () => {
    expect(apiScopesAllowWrite([])).toBe(true);
    expect(apiScopesAllowWrite(['read', 'write'])).toBe(true);
    expect(apiScopesAllowWrite(['read'])).toBe(false);
  });
});

describe('AuthService — Google OAuth login', () => {
  let prisma: MockPrismaClient;
  let userService: UserService;
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    userService = new UserService(prisma as never);
    vi.spyOn(userService, 'getOrganizationForUser').mockResolvedValue(null);
    service = new AuthService(prisma as never, userService);
    vi.stubEnv('GOOGLE_CLIENT_ID', 'test-client-id');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('startGoogleAuth throws when GOOGLE_CLIENT_ID is not configured', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    await expect(service.startGoogleAuth()).rejects.toThrow(/not configured/);
  });

  it('startGoogleAuth returns the consent URL with a signed state', async () => {
    const { url, state } = await service.startGoogleAuth();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/google/callback',
    );
    expect(parsed.searchParams.get('scope')).toBe('openid email profile');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe(state);
    // The state must round-trip through the google verifier
    await expect(verifyOAuthState(state, 'google')).resolves.toBeUndefined();
  });

  it('exchangeGoogleCode rejects an invalid state', async () => {
    await expect(service.exchangeGoogleCode('code', 'garbage')).rejects.toThrow(
      /Invalid or expired OAuth state/,
    );
  });

  it('exchangeGoogleCode rejects a github_login state presented as a google state', async () => {
    const { state } = await signOAuthState('github_login');
    await expect(service.exchangeGoogleCode('code', state)).rejects.toThrow(
      /Invalid or expired OAuth state/,
    );
  });

  it('exchangeGoogleCode signs the user in with the resolved profile', async () => {
    const { state } = await service.startGoogleAuth();
    vi.stubGlobal('fetch', buildGoogleFetchMock({}));
    const findOrCreate = vi.spyOn(userService, 'findOrCreate').mockResolvedValue(TEST_USER);
    prisma.authToken.create.mockResolvedValue({});

    const result = await service.exchangeGoogleCode('good-code', state);

    expect(result.success).toBe(true);
    expect(result.userId).toBe(TEST_USER.id);
    expect(findOrCreate).toHaveBeenCalledWith({
      avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
      email: 'verified@example.com',
      googleId: '1234567890',
      name: 'Ada Lovelace',
    });
  });

  it('exchangeGoogleCode rejects an unverified Google email', async () => {
    const { state } = await service.startGoogleAuth();
    vi.stubGlobal('fetch', buildGoogleFetchMock({ verified_email: false }));

    await expect(service.exchangeGoogleCode('good-code', state)).rejects.toThrow(
      /no verified email/,
    );
  });

  it('exchangeGoogleCode falls back to the email local-part when the profile has no name', async () => {
    const { state } = await service.startGoogleAuth();
    vi.stubGlobal('fetch', buildGoogleFetchMock({ email: 'ada@example.com', name: null }));
    const findOrCreate = vi.spyOn(userService, 'findOrCreate').mockResolvedValue(TEST_USER);
    prisma.authToken.create.mockResolvedValue({});

    await service.exchangeGoogleCode('good-code', state);

    expect(findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'ada' }));
  });

  it('exchangeGoogleCode rejects when the code exchange fails', async () => {
    const { state } = await service.startGoogleAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 400 })),
    );

    await expect(service.exchangeGoogleCode('bad-code', state)).rejects.toThrow(
      /Failed to exchange Google authorization code/,
    );
  });

  it('exchangeGoogleCode rejects when the profile lookup fails', async () => {
    const { state } = await service.startGoogleAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          return jsonResponse({ access_token: 'ya29.test' });
        }
        return new Response('nope', { status: 401 });
      }),
    );

    await expect(service.exchangeGoogleCode('good-code', state)).rejects.toThrow(
      /Failed to fetch Google user profile/,
    );
  });
});

describe('AuthService — GitHub OAuth login', () => {
  let prisma: MockPrismaClient;
  let userService: UserService;
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    userService = new UserService(prisma as never);
    vi.spyOn(userService, 'getOrganizationForUser').mockResolvedValue(null);
    service = new AuthService(prisma as never, userService);
    vi.stubEnv('GITHUB_CLIENT_ID', 'test-client-id');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'test-client-secret');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('startGithubAuth throws when GITHUB_CLIENT_ID is not configured', async () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    await expect(service.startGithubAuth()).rejects.toThrow(/not configured/);
  });

  it('startGithubAuth returns the authorize URL with a signed state', async () => {
    const { url, state } = await service.startGithubAuth();
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/github/callback',
    );
    expect(parsed.searchParams.get('scope')).toBe('read:user user:email');
    expect(parsed.searchParams.get('state')).toBe(state);
    // The state must round-trip through the github_login verifier
    await expect(verifyOAuthState(state, 'github_login')).resolves.toBeUndefined();
  });

  it('exchangeGithubCode rejects an invalid state', async () => {
    await expect(service.exchangeGithubCode('code', 'garbage')).rejects.toThrow(
      /Invalid or expired OAuth state/,
    );
  });

  it('exchangeGithubCode rejects a state signed for the integration flow', async () => {
    const integrationState = await signGithubOAuthState({
      orgId: '00000000-0000-0000-0000-000000000001',
      userId: TEST_USER.id,
      webhookSecret: 'whsec',
    });
    await expect(service.exchangeGithubCode('code', integrationState)).rejects.toThrow(
      /Invalid or expired OAuth state/,
    );
  });

  it('exchangeGithubCode signs the user in with the verified primary email', async () => {
    const { state } = await service.startGithubAuth();
    vi.stubGlobal('fetch', buildGithubFetchMock({}));
    const findOrCreate = vi.spyOn(userService, 'findOrCreate').mockResolvedValue(TEST_USER);
    prisma.authToken.create.mockResolvedValue({});

    const result = await service.exchangeGithubCode('good-code', state);

    expect(result.success).toBe(true);
    expect(result.userId).toBe(TEST_USER.id);
    expect(findOrCreate).toHaveBeenCalledWith({
      avatarUrl: 'https://avatars.githubusercontent.com/u/42',
      email: 'verified@example.com',
      githubId: '42',
      name: 'Octo Cat',
    });
  });

  it('exchangeGithubCode falls back to the login when the profile has no name', async () => {
    const { state } = await service.startGithubAuth();
    vi.stubGlobal('fetch', buildGithubFetchMock({ name: null }));
    const findOrCreate = vi.spyOn(userService, 'findOrCreate').mockResolvedValue(TEST_USER);
    prisma.authToken.create.mockResolvedValue({});

    await service.exchangeGithubCode('good-code', state);

    expect(findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'octocat' }));
  });

  it('exchangeGithubCode rejects accounts with no verified email', async () => {
    const { state } = await service.startGithubAuth();
    vi.stubGlobal(
      'fetch',
      buildGithubFetchMock({
        emails: [{ email: 'unverified@example.com', primary: true, verified: false }],
      }),
    );

    await expect(service.exchangeGithubCode('good-code', state)).rejects.toThrow(
      /no verified email/,
    );
  });

  it('exchangeGithubCode rejects when the code exchange returns an error body', async () => {
    const { state } = await service.startGithubAuth();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'bad_verification_code' })),
    );

    await expect(service.exchangeGithubCode('bad-code', state)).rejects.toThrow(
      /Failed to exchange GitHub authorization code/,
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

function buildGoogleFetchMock(
  overrides: Partial<{
    name: string | null;
    email: string;
    verified_email: boolean;
    picture: string | null;
  }>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'ya29.test' });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v2/userinfo')) {
      return jsonResponse({
        email: overrides.email ?? 'verified@example.com',
        id: '1234567890',
        name: overrides.name === undefined ? 'Ada Lovelace' : overrides.name,
        picture:
          overrides.picture === undefined
            ? 'https://lh3.googleusercontent.com/a/photo'
            : overrides.picture,
        verified_email: overrides.verified_email ?? true,
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

function buildGithubFetchMock(
  overrides: Partial<{
    name: string | null;
    emails: Array<{ email: string; primary: boolean; verified: boolean }>;
  }>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return jsonResponse({ access_token: 'gho_test' });
    }
    if (url.startsWith('https://api.github.com/user/emails')) {
      return jsonResponse(
        overrides.emails ?? [
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'verified@example.com', primary: true, verified: true },
        ],
      );
    }
    if (url.startsWith('https://api.github.com/user')) {
      return jsonResponse({
        avatar_url: 'https://avatars.githubusercontent.com/u/42',
        email: null,
        id: 42,
        login: 'octocat',
        name: overrides.name === undefined ? 'Octo Cat' : overrides.name,
      });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
}

describe('AuthService.refreshTokens — organization continuity', () => {
  let prisma: MockPrismaClient;
  let userService: UserService;
  let service: AuthService;
  const SWITCHED_ORG = '00000000-0000-0000-0000-0000000000e1';
  const DEFAULT_ORG = '00000000-0000-0000-0000-0000000000e2';

  beforeEach(() => {
    prisma = createMockPrisma();
    userService = new UserService(prisma as never);
    vi.spyOn(userService, 'getOrganizationForUser').mockResolvedValue({
      id: DEFAULT_ORG,
    } as never);
    service = new AuthService(prisma as never, userService);
    prisma.authToken.update.mockResolvedValue({});
    prisma.authToken.create.mockResolvedValue({});
  });

  it('keeps the session in the org it was switched to', async () => {
    // The regression this guards: the org used to be re-derived on every
    // rotation as "oldest usable membership", so a multi-org user was pulled
    // back to their first workspace whenever the 24h access token expired —
    // silently undoing a switch they made deliberately.
    vi.spyOn(userService, 'findUsableMembership').mockResolvedValue({
      organization: { id: SWITCHED_ORG },
      role: 'member',
    } as never);
    const rawToken = await signValidRefreshToken();
    prisma.authToken.findFirst.mockResolvedValue(makeTokenRow({ organizationId: SWITCHED_ORG }));

    await service.refreshTokens(rawToken);

    expect(prisma.authToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: SWITCHED_ORG }),
      }),
    );
    expect(userService.getOrganizationForUser).not.toHaveBeenCalled();
  });

  it('falls back to the default org when that membership was revoked', async () => {
    // A rotation is a fresh authorization decision — the stored org is
    // re-validated, not trusted, so a revoked membership can't be refreshed
    // back into.
    vi.spyOn(userService, 'findUsableMembership').mockResolvedValue(null);
    const rawToken = await signValidRefreshToken();
    prisma.authToken.findFirst.mockResolvedValue(makeTokenRow({ organizationId: SWITCHED_ORG }));

    await service.refreshTokens(rawToken);

    expect(userService.getOrganizationForUser).toHaveBeenCalled();
    expect(prisma.authToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: DEFAULT_ORG }),
      }),
    );
  });

  it('resolves a default for a legacy token that carries no org', async () => {
    const rawToken = await signValidRefreshToken();
    prisma.authToken.findFirst.mockResolvedValue(makeTokenRow({ organizationId: null }));

    await service.refreshTokens(rawToken);

    expect(prisma.authToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: DEFAULT_ORG }),
      }),
    );
  });
});
