import crypto from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '30d';
const OAUTH_STATE_EXPIRY = '10m';

// HS256 (HMAC-SHA256) recommends secrets >= 32 bytes per RFC 7518 §3.2.
// `jose` does not enforce this itself, so we validate at boot to fail fast
// on weak/placeholder secrets.
const MIN_SECRET_BYTES = 32;

function getSecret(key: string): Uint8Array {
  const secret = process.env[key];
  if (!secret) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  const encoded = new TextEncoder().encode(secret);
  if (encoded.byteLength < MIN_SECRET_BYTES) {
    throw new Error(
      `${key} must be at least ${MIN_SECRET_BYTES} bytes for HS256. ` +
        'Generate one with: openssl rand -base64 48',
    );
  }
  return encoded;
}

export interface AccessTokenPayload {
  userId: string;
  orgId: string;
}

export interface RefreshTokenPayload {
  userId: string;
  tokenId: string;
}

export async function signAccessToken(
  payload: AccessTokenPayload,
): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getSecret('JWT_SECRET'));
}

export async function signRefreshToken(
  payload: RefreshTokenPayload,
): Promise<string> {
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getSecret('JWT_REFRESH_SECRET'));
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret('JWT_SECRET'));

  if (payload.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return {
    orgId: payload.orgId as string,
    userId: payload.userId as string,
  };
}

export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret('JWT_REFRESH_SECRET'));

  if (payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }

  return {
    tokenId: payload.tokenId as string,
    userId: payload.userId as string,
  };
}

// Access token expires in 24h = 86400 seconds
export const ACCESS_TOKEN_EXPIRY_SECONDS = 86400;

/**
 * Sign a short-lived OAuth "state" JWT used to prevent CSRF on the
 * Google OAuth redirect chain. The token carries a random nonce and a
 * narrow `type: 'oauth_state'` claim so it cannot be substituted for an
 * access/refresh token. Expires in 10 minutes — long enough for the user
 * to complete a Google consent screen, short enough to limit replay.
 */
export async function signOAuthState(
  provider: 'google',
): Promise<{ state: string; nonce: string }> {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const state = await new SignJWT({ nonce, provider, type: 'oauth_state' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_EXPIRY)
    .sign(getSecret('JWT_SECRET'));
  return { nonce, state };
}

export async function verifyOAuthState(
  state: string,
  provider: 'google',
): Promise<void> {
  const { payload } = await jwtVerify(state, getSecret('JWT_SECRET'));
  if (payload.type !== 'oauth_state' || payload.provider !== provider) {
    throw new Error('Invalid OAuth state token');
  }
}
