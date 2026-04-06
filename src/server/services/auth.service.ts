import crypto from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma';
import { sendMagicLinkEmail } from '../lib/email';
import {
  ACCESS_TOKEN_EXPIRY_SECONDS,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/jwt';
import type { UserService } from './user.service';

const MAGIC_LINK_EXPIRY_MINUTES = 15;
const REFRESH_GRACE_PERIOD_MINUTES = 30;

export interface EmailLoginPayload {
  success: boolean;
}

export interface AuthPayload {
  success: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
}

export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private userService: UserService,
  ) {}

  async sendMagicLink(email: string): Promise<EmailLoginPayload> {
    // Generate a 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const tokenHash = hashToken(code);
    const expiresAt = new Date(
      Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
    );

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
          code,
          expiresAt,
          tokenHash,
          type: 'magic_link',
          userId: user.id,
        },
      });
    } else {
      // We still send the email so as not to leak whether the account exists.
      // The token is stored against the email but we need a user record first.
      // Create a placeholder user record if needed.
      const newUser = await this.userService.findOrCreate({
        email,
        name: email.split('@')[0],
      });

      await this.prisma.authToken.create({
        data: {
          code,
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
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new InvalidCodeError();
    }

    const token = await this.prisma.authToken.findFirst({
      where: {
        code,
        expiresAt: { gt: new Date() },
        revokedAt: null,
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

  async exchangeGoogleCode(
    code: string,
    redirectUri: string,
  ): Promise<AuthPayload> {
    const profile = await fetchGoogleProfile(code, redirectUri);

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

    const token = await this.prisma.authToken.findFirst({
      where: {
        id: payload.tokenId,
        revokedAt: null,
        tokenHash,
        type: 'refresh',
        userId: payload.userId,
      },
    });

    if (!token || token.expiresAt < new Date()) {
      throw new InvalidTokenError();
    }

    // Revoke old refresh token (with grace period)
    const graceEnd = new Date(
      Date.now() + REFRESH_GRACE_PERIOD_MINUTES * 60 * 1000,
    );
    await this.prisma.authToken.update({
      data: { lastUsedAt: new Date(), revokedAt: graceEnd },
      where: { id: token.id },
    });

    return this.issueTokenPair(payload.userId);
  }

  async logout(userId: string, rawRefreshToken?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await this.prisma.authToken.updateMany({
        data: { revokedAt: new Date() },
        where: { revokedAt: null, tokenHash, type: 'refresh', userId },
      });
    } else {
      // Revoke all refresh tokens for the user
      await this.prisma.authToken.updateMany({
        data: { revokedAt: new Date() },
        where: { revokedAt: null, type: 'refresh', userId },
      });
    }
  }

  private async issueTokenPair(userId: string): Promise<AuthPayload> {
    const org = await this.userService.getOrganizationForUser(userId);
    const orgId = org?.id ?? '';

    const refreshTokenRecord = await this.prisma.authToken.create({
      data: {
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        tokenHash: 'pending',
        type: 'refresh',
        userId,
      },
    });

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ orgId, userId }),
      signRefreshToken({ tokenId: refreshTokenRecord.id, userId }),
    ]);

    // Store actual hash now that we have the signed token
    await this.prisma.authToken.update({
      data: { tokenHash: hashToken(refreshToken) },
      where: { id: refreshTokenRecord.id },
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

class InvalidCodeError extends Error {
  constructor() {
    super('Invalid or expired verification code');
    this.name = 'InvalidCodeError';
  }
}

class InvalidTokenError extends Error {
  constructor() {
    super('Invalid or expired token');
    this.name = 'InvalidTokenError';
  }
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
    throw new Error('Failed to exchange Google authorization code');
  }

  const tokenData = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    },
  );

  if (!profileRes.ok) {
    throw new Error('Failed to fetch Google user profile');
  }

  return profileRes.json() as Promise<{
    id: string;
    email: string;
    name: string;
    picture?: string;
  }>;
}
