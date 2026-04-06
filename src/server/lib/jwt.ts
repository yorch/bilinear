import { jwtVerify, SignJWT } from 'jose';

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '30d';

function getSecret(key: string): Uint8Array {
  const secret = process.env[key];
  if (!secret) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return new TextEncoder().encode(secret);
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
