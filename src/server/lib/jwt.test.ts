import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import {
  signAccessToken,
  signGithubOAuthState,
  signOAuthState,
  signRefreshToken,
  verifyAccessToken,
  verifyGithubOAuthState,
  verifyOAuthState,
  verifyRefreshToken,
} from './jwt';

describe('signOAuthState / verifyOAuthState', () => {
  it('round-trips a freshly issued state token', async () => {
    const { state, nonce } = await signOAuthState('google');

    expect(typeof state).toBe('string');
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    await expect(verifyOAuthState(state, 'google')).resolves.toBeUndefined();
  });

  it('rejects a state token issued for a different provider', async () => {
    // jose has no second provider yet, so simulate by hand-rolling a token
    // with the wrong `provider` claim signed with the same key.
    const secret = new TextEncoder().encode(process.env.JWT_SECRET as string);
    const otherProviderToken = await new SignJWT({
      nonce: 'abc',
      provider: 'github',
      type: 'oauth_state',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);

    await expect(verifyOAuthState(otherProviderToken, 'google')).rejects.toThrow();
  });

  it('rejects an access token presented as a state token', async () => {
    const access = await signAccessToken({
      orgId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000010',
    });

    await expect(verifyOAuthState(access, 'google')).rejects.toThrow();
  });

  it('rejects an expired state token', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const { state } = await signOAuthState('google');
      // OAUTH_STATE_EXPIRY is 10m; jump 11m forward.
      vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));

      await expect(verifyOAuthState(state, 'google')).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('signGithubOAuthState / verifyGithubOAuthState', () => {
  const PAYLOAD = {
    orgId: '00000000-0000-0000-0000-000000000001',
    userId: '00000000-0000-0000-0000-000000000010',
    webhookSecret: 'a-sufficiently-long-secret',
  };

  it('round-trips the org/user/webhookSecret payload', async () => {
    const state = await signGithubOAuthState(PAYLOAD);
    await expect(verifyGithubOAuthState(state)).resolves.toEqual(PAYLOAD);
  });

  it('rejects a tampered (re-signed by another key) state', async () => {
    const wrongKey = new TextEncoder().encode('x'.repeat(48));
    const forged = await new SignJWT({ ...PAYLOAD, provider: 'github', type: 'oauth_state' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(wrongKey);

    await expect(verifyGithubOAuthState(forged)).rejects.toThrow();
  });

  it('rejects a google state presented as a github state', async () => {
    const { state } = await signOAuthState('google');
    await expect(verifyGithubOAuthState(state)).rejects.toThrow();
  });
});

describe('access / refresh token type guards', () => {
  it('verifyAccessToken rejects a refresh token', async () => {
    const refresh = await signRefreshToken({
      tokenId: '00000000-0000-0000-0000-0000000bbbbb',
      userId: '00000000-0000-0000-0000-000000000010',
    });

    await expect(verifyAccessToken(refresh)).rejects.toThrow();
  });

  it('verifyRefreshToken rejects an access token', async () => {
    const access = await signAccessToken({
      orgId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000010',
    });

    await expect(verifyRefreshToken(access)).rejects.toThrow();
  });
});
