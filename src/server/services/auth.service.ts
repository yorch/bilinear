import crypto from 'node:crypto';
import type { AuthToken, PrismaClient } from '../../generated/prisma';
import { sendMagicLinkEmail } from '../lib/email';
import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
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
const REFRESH_TOKEN_DAYS = 30;

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

    await sendMagicLinkEmail(email, code);

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
  ): Promise<{ plaintext: string; token: AuthToken }> {
    if (!label.trim()) {
      throw new Error('Label is required');
    }
    const plaintext = `bil_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = hashToken(plaintext);
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const token = await this.prisma.authToken.create({
      data: { expiresAt, label: label.trim(), tokenHash, type: 'api_key', userId },
    });
    return { plaintext, token };
  }

  async listApiTokens(userId: string) {
    return this.prisma.authToken.findMany({
      orderBy: { createdAt: 'desc' },
      where: { revokedAt: null, type: 'api_key', userId },
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
 * Resolve the server-authoritative Google OAuth redirect URI. Prefers the
 * explicit `GOOGLE_REDIRECT_URI` env (so prod/preview/dev can each register
 * their own) and falls back to `APP_URL + /auth/google/callback`.
 */
function getGoogleRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI;
  if (explicit) {
    return explicit;
  }
  const appUrl = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${appUrl}/auth/google/callback`;
}

async function fetchGoogleProfile(code: string, redirectUri: string) {
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

  return profileRes.json() as Promise<{
    id: string;
    email: string;
    name: string;
    picture?: string;
  }>;
}
