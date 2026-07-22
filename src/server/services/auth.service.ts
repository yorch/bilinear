import crypto from 'node:crypto';
import type { AuthToken, PrismaClient } from '../../generated/prisma';
import { sendMagicLinkEmail } from '../lib/email';
import { env } from '../lib/env';
import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_DAYS,
  signAccessToken,
  signOAuthState,
  signRefreshToken,
  verifyOAuthState,
  verifyRefreshToken,
} from '../lib/jwt';
import { childLogger } from '../lib/logger';
import type { UserService } from './user.service';

const securityLog = childLogger({ event: 'security', module: 'auth' });

const MAGIC_LINK_EXPIRY_MINUTES = 15;
const REFRESH_GRACE_PERIOD_MINUTES = 30;

/** Recognised API-key permission scopes. */
export const VALID_API_SCOPES = new Set(['read', 'write']);
/** Scopes granted when a key is created without an explicit selection. */
export const DEFAULT_API_SCOPES = ['read', 'write'] as const;

/**
 * Does this scope set permit write (mutation) operations? Empty scopes are
 * treated as full access (legacy keys predate the scopes column), matching
 * the migration default and `createApiToken`'s empty→full normalisation.
 */
export function apiScopesAllowWrite(scopes: string[]): boolean {
  return scopes.length === 0 || scopes.includes('write');
}

export interface EmailLoginPayload {
  success: boolean;
}

export interface AuthPayload {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  success: boolean;
  userId: string;
}

export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private userService: UserService,
  ) {}

  async sendMagicLink(email: string): Promise<EmailLoginPayload> {
    // Use a cryptographically secure RNG — Math.random() is not a CSPRNG.
    const code = String(crypto.randomInt(100000, 1000000));
    // Store a hash of the code so a DB compromise doesn't yield valid codes.
    const tokenHash = hashToken(code);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000);

    // Revoke any existing unused magic link tokens for this email
    const user = await this.userService.findByEmail(email);
    if (user) {
      await this.prisma.authToken.updateMany({
        data: { revokedAt: new Date() },
        where: {
          expiresAt: { gt: new Date() },
          revokedAt: null,
          type: 'magic_link',
          userId: user.id,
        },
      });

      await this.prisma.authToken.create({
        data: {
          expiresAt,
          // Store tokenHash only — raw code is only in the email.
          // verifyMagicLink hashes the submitted code and compares.
          tokenHash,
          type: 'magic_link',
          userId: user.id,
        },
      });
    } else {
      // We still send the email so as not to leak whether the account exists.
      // Create a placeholder user record if needed.
      const newUser = await this.userService.findOrCreate({
        email,
        name: email.split('@')[0],
      });

      await this.prisma.authToken.create({
        data: {
          expiresAt,
          tokenHash,
          type: 'magic_link',
          userId: newUser.id,
        },
      });
    }

    // Localize to a returning user's saved preference; brand-new accounts have
    // no stored locale yet, so they fall back to the app default.
    await sendMagicLinkEmail(email, code, user?.locale);

    return { success: true };
  }

  async verifyMagicLink(email: string, code: string): Promise<AuthPayload> {
    // Test mode bypass: accept TEST_AUTH_CODE without a real DB token.
    //
    // Gating on `process.env.NODE_ENV !== 'production'` rather than `=== 'test'`
    // is intentional: Turbopack/webpack inline `process.env.NODE_ENV` at
    // compile time, and `next dev` always compiles with the literal
    // 'development' regardless of the runtime env. With `=== 'test'`, the
    // bypass branch was statically false in dev builds and eliminated as dead
    // code, so e2e tests that rely on it never authenticated. The new check
    // is statically true in dev builds and statically false in production
    // builds, so the bypass is reachable for `yarn dev` (used by the e2e
    // suite) and unreachable in production deployments.
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.TEST_AUTH_CODE &&
      code === process.env.TEST_AUTH_CODE
    ) {
      const user = await this.userService.findOrCreate({
        email,
        name: email.split('@')[0],
      });
      return this.issueTokenPair(user.id);
    }

    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new InvalidCodeError();
    }

    // Compare by hash — never query by raw code to avoid timing side-channels.
    // Atomically claim the token via updateMany scoped to `revokedAt: null` so
    // two concurrent verifyMagicLink requests for the same code race on the DB
    // and exactly one wins. Without this guard, both calls passed find-then-
    // update and both received valid token pairs.
    const tokenHash = hashToken(code);
    const now = new Date();
    const claim = await this.prisma.authToken.updateMany({
      data: { lastUsedAt: now, revokedAt: now },
      where: {
        expiresAt: { gt: now },
        revokedAt: null,
        tokenHash,
        type: 'magic_link',
        userId: user.id,
      },
    });

    if (claim.count !== 1) {
      throw new InvalidCodeError();
    }

    return this.issueTokenPair(user.id);
  }

  /**
   * Returns the Google OAuth consent URL plus a signed `state` token that
   * the callback page must send back to `exchangeGoogleCode`. The redirect
   * URI is server-controlled — the client cannot influence where Google
   * returns the code, which closes the "attacker-chosen redirect_uri"
   * exchange path.
   */
  async startGoogleAuth(): Promise<{ url: string; state: string }> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new OAuthError('Google OAuth is not configured');
    }
    const { state } = await signOAuthState('google');
    const params = new URLSearchParams({
      access_type: 'offline',
      client_id: clientId,
      prompt: 'consent',
      redirect_uri: getGoogleRedirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return { state, url };
  }

  async exchangeGoogleCode(code: string, state: string): Promise<AuthPayload> {
    try {
      await verifyOAuthState(state, 'google');
    } catch {
      throw new OAuthError('Invalid or expired OAuth state');
    }

    const profile = await fetchGoogleProfile(code, getGoogleRedirectUri());

    const user = await this.userService.findOrCreate({
      avatarUrl: profile.picture,
      email: profile.email,
      googleId: profile.id,
      name: profile.name,
    });

    return this.issueTokenPair(user.id);
  }

  /**
   * Returns the GitHub OAuth consent URL plus a signed `state` token that
   * the callback page must send back to `exchangeGithubCode`. Reuses the
   * same OAuth App credentials as the org integration (`GITHUB_CLIENT_ID` /
   * `GITHUB_CLIENT_SECRET`); the redirect URI is server-controlled.
   */
  async startGithubAuth(): Promise<{ url: string; state: string }> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      throw new OAuthError('GitHub OAuth is not configured');
    }
    const { state } = await signOAuthState('github_login');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getGithubRedirectUri(),
      // read:user for profile, user:email so private primary emails are
      // still visible via /user/emails.
      scope: 'read:user user:email',
      state,
    });
    const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
    return { state, url };
  }

  async exchangeGithubCode(code: string, state: string): Promise<AuthPayload> {
    try {
      await verifyOAuthState(state, 'github_login');
    } catch {
      throw new OAuthError('Invalid or expired OAuth state');
    }

    const profile = await fetchGithubProfile(code, getGithubRedirectUri());

    const user = await this.userService.findOrCreate({
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      // Stored as a string (like googleId) — the numeric GitHub id is only an
      // opaque identity key here, and a string column can't overflow int4.
      githubId: String(profile.id),
      name: profile.name,
    });

    return this.issueTokenPair(user.id);
  }

  async refreshTokens(rawRefreshToken: string): Promise<AuthPayload> {
    let payload: { userId: string; tokenId: string };
    try {
      payload = await verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new InvalidTokenError();
    }

    const tokenHash = hashToken(rawRefreshToken);

    // Look up by (id, hash, userId) WITHOUT filtering on revokedAt so we can
    // distinguish "never-issued / wrong token" (404) from "revoked token
    // replay" (reuse detection).
    const token = await this.prisma.authToken.findFirst({
      where: {
        id: payload.tokenId,
        tokenHash,
        type: 'refresh',
        userId: payload.userId,
      },
    });

    if (!token || token.expiresAt < new Date()) {
      throw new InvalidTokenError();
    }

    const now = new Date();
    // revokedAt is set by rotation with a future timestamp (the grace window).
    // If revokedAt is in the past, this token was rotated more than the grace
    // period ago AND is being presented again — classic reuse. Kill the family.
    if (token.revokedAt && token.revokedAt < now) {
      // Refresh-token reuse detected — someone is replaying a previously-
      // rotated token outside the grace window. Kill the whole family so a
      // compromised token can't keep producing new access tokens, and log
      // a warn-level security event so this lands in observability /
      // Sentry for incident response.
      if (token.familyId) {
        await this.prisma.authToken.updateMany({
          data: { revokedAt: now },
          where: {
            familyId: token.familyId,
            revokedAt: null,
            type: 'refresh',
          },
        });
      }
      securityLog.warn(
        {
          eventType: 'refresh_token_reuse',
          familyId: token.familyId,
          tokenId: token.id,
          userId: token.userId,
        },
        'Refresh token reuse detected — revoking token family',
      );
      throw new InvalidTokenError();
    }

    // Revoke old refresh token (with grace period to handle concurrent requests)
    const graceEnd = new Date(now.getTime() + REFRESH_GRACE_PERIOD_MINUTES * 60 * 1000);
    await this.prisma.authToken.update({
      data: { lastUsedAt: now, revokedAt: graceEnd },
      where: { id: token.id },
    });

    // Rotate within the same family so a future replay can be traced back.
    return this.issueTokenPair(payload.userId, undefined, token.familyId);
  }

  async logout(userId: string, rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await this.prisma.authToken.updateMany({
        data: { revokedAt: new Date() },
        where: { revokedAt: null, tokenHash, type: 'refresh', userId },
      });
    } else {
      // Revoke all refresh tokens for the user (full sign-out)
      await this.prisma.authToken.updateMany({
        data: { revokedAt: new Date() },
        where: { revokedAt: null, type: 'refresh', userId },
      });
    }
  }

  /** Re-issue access + refresh tokens after an org change (e.g. onboarding). */
  async reissueTokens(userId: string, orgId: string): Promise<AuthPayload> {
    return this.issueTokenPair(userId, orgId);
  }

  async createApiToken(
    userId: string,
    label: string,
    opts: { scopes?: string[]; expiresInDays?: number } = {},
  ): Promise<{ plaintext: string; token: AuthToken }> {
    if (!label.trim()) {
      throw new Error('Label is required');
    }
    // Normalise scopes to the recognised set. Empty/absent → full access
    // (`read` + `write`) so the API stays usable without forcing a choice.
    const requested = opts.scopes?.map(s => s.trim().toLowerCase()).filter(Boolean) ?? [];
    const invalid = requested.filter(s => !VALID_API_SCOPES.has(s));
    if (invalid.length > 0) {
      throw new Error(`Invalid scope(s): ${invalid.join(', ')}`);
    }
    const scopes = requested.length > 0 ? Array.from(new Set(requested)) : [...DEFAULT_API_SCOPES];

    // Expiry: default 1 year, configurable, clamped to [1, 3650] days.
    const days = opts.expiresInDays ?? 365;
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      throw new Error('expiresInDays must be between 1 and 3650');
    }
    const plaintext = `bil_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = hashToken(plaintext);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const token = await this.prisma.authToken.create({
      data: { expiresAt, label: label.trim(), scopes, tokenHash, type: 'api_key', userId },
    });
    return { plaintext, token };
  }

  async listApiTokens(userId: string) {
    return this.prisma.authToken.findMany({
      orderBy: { createdAt: 'desc' },
      where: { expiresAt: { gt: new Date() }, revokedAt: null, type: 'api_key', userId },
    });
  }

  async revokeApiToken(userId: string, id: string): Promise<void> {
    await this.prisma.authToken.updateMany({
      data: { revokedAt: new Date() },
      where: { id, type: 'api_key', userId },
    });
  }

  private async issueTokenPair(
    userId: string,
    knownOrgId?: string,
    existingFamilyId?: string | null,
  ): Promise<AuthPayload> {
    let orgId = knownOrgId;
    if (!orgId) {
      const org = await this.userService.getOrganizationForUser(userId);
      orgId = org?.id ?? '';
    }

    // Pre-generate a UUID so we can sign the refresh JWT before inserting the
    // DB record. This avoids a two-step create → update with a 'pending' hash
    // placeholder that could be left dangling on server crash.
    const tokenId = crypto.randomUUID();
    // New session → new family. Rotation → inherit parent's family so reuse
    // detection can revoke every descendant at once.
    const familyId = existingFamilyId ?? crypto.randomUUID();
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ orgId, userId }),
      signRefreshToken({ tokenId, userId }),
    ]);

    // Insert with real hash in a single write — no intermediate 'pending' state.
    await this.prisma.authToken.create({
      data: {
        expiresAt,
        familyId,
        id: tokenId,
        tokenHash: hashToken(refreshToken),
        type: 'refresh',
        userId,
      },
    });

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
      refreshToken,
      success: true,
      userId,
    };
  }
}

function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class InvalidCodeError extends Error {
  constructor() {
    super('Invalid or expired verification code');
    this.name = 'InvalidCodeError';
  }
}

export class InvalidTokenError extends Error {
  constructor() {
    super('Invalid or expired token');
    this.name = 'InvalidTokenError';
  }
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthError';
  }
}

/**
 * Resolve a server-authoritative OAuth redirect URI. Prefers the provider's
 * explicit `*_REDIRECT_URI` env (so prod/preview/dev can each register their
 * own) and falls back to `APP_URL + callbackPath`.
 */
function getOAuthRedirectUri(explicitUri: string | undefined, callbackPath: string): string {
  if (explicitUri) {
    return explicitUri;
  }
  const appUrl = env.APP_URL.replace(/\/$/, '');
  return `${appUrl}${callbackPath}`;
}

function getGoogleRedirectUri(): string {
  return getOAuthRedirectUri(process.env.GOOGLE_REDIRECT_URI, '/auth/google/callback');
}

interface GoogleLoginProfile {
  email: string;
  id: string;
  name: string;
  picture?: string;
}

async function fetchGoogleProfile(code: string, redirectUri: string): Promise<GoogleLoginProfile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });

  if (!tokenRes.ok) {
    throw new OAuthError('Failed to exchange Google authorization code');
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!profileRes.ok) {
    throw new OAuthError('Failed to fetch Google user profile');
  }

  const profile = (await profileRes.json()) as {
    id: string;
    email?: string;
    verified_email?: boolean;
    name?: string;
    picture?: string;
  };

  // findOrCreate links accounts by email, so accepting an unverified address
  // would let an attacker set their Google email to a victim's and take over
  // that account here — mirror the GitHub path and require a verified email.
  if (!profile.email || !profile.verified_email) {
    throw new OAuthError('Your Google account has no verified email address');
  }

  return {
    email: profile.email,
    id: profile.id,
    // Google omits `name` under restricted consent; fall back to the email
    // local-part so display-name / initial derivation never sees an empty
    // or undefined name (which would throw in deriveInitials).
    name: profile.name?.trim() || profile.email.split('@')[0],
    picture: profile.picture,
  };
}

/**
 * GitHub *login* redirect URI — distinct from the org-integration callback
 * (`/api/integrations/github/callback`).
 */
function getGithubRedirectUri(): string {
  return getOAuthRedirectUri(process.env.GITHUB_REDIRECT_URI, '/auth/github/callback');
}

interface GithubLoginProfile {
  avatarUrl?: string;
  email: string;
  id: number;
  name: string;
}

async function fetchGithubProfile(code: string, redirectUri: string): Promise<GithubLoginProfile> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    body: new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID ?? '',
      client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
    }),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });

  if (!tokenRes.ok) {
    throw new OAuthError('Failed to exchange GitHub authorization code');
  }

  // GitHub returns 200 with an `error` body for bad/expired codes.
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    throw new OAuthError('Failed to exchange GitHub authorization code');
  }

  const apiHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${tokenData.access_token}`,
  };

  // The two lookups are independent given the token — fetch them in parallel.
  const [profileRes, emailsRes] = await Promise.all([
    fetch('https://api.github.com/user', { headers: apiHeaders }),
    fetch('https://api.github.com/user/emails', { headers: apiHeaders }),
  ]);
  if (!profileRes.ok) {
    throw new OAuthError('Failed to fetch GitHub user profile');
  }
  const profile = (await profileRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url?: string;
  };

  // `/user.email` is the public profile email — often null, and even when set
  // it is not necessarily verified. Always resolve the email via
  // /user/emails and require `verified` — findOrCreate links accounts by
  // email, so accepting an unverified address would let an attacker claim a
  // victim's email on GitHub and take over their account here.
  if (!emailsRes.ok) {
    throw new OAuthError('Failed to fetch GitHub email addresses');
  }
  const emails = (await emailsRes.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const email = (emails.find(e => e.primary && e.verified) ?? emails.find(e => e.verified))?.email;
  if (!email) {
    throw new OAuthError('Your GitHub account has no verified email address');
  }

  return {
    avatarUrl: profile.avatar_url,
    email,
    id: profile.id,
    name: profile.name?.trim() || profile.login,
  };
}
