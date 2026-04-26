import crypto from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma';
import { sendMagicLinkEmail } from '../lib/email';
import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
  signAccessToken,
  signOAuthState,
  signRefreshToken,
  verifyOAuthState,
  verifyRefreshToken,
} from '../lib/jwt';
import type { UserService } from './user.service';

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
    // Strictly gated to NODE_ENV === 'test' so misconfigured staging/preview
    // deployments (which may run with NODE_ENV=development) cannot accept a
    // static login code. Playwright sets NODE_ENV=test explicitly.
    if (
      process.env.NODE_ENV === 'test' &&
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
    const tokenHash = hashToken(code);
    const token = await this.prisma.authToken.findFirst({
      where: {
        expiresAt: { gt: new Date() },
        revokedAt: null,
        tokenHash,
        type: 'magic_link',
        userId: user.id,
      },
    });

    if (!token) {
      throw new InvalidCodeError();
    }

    // Revoke used token
    await this.prisma.authToken.update({
      data: { lastUsedAt: new Date(), revokedAt: new Date() },
      where: { id: token.id },
    });

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
