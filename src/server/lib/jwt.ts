import crypto from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '30d';
const OAUTH_STATE_EXPIRY = '10m';
const WS_TICKET_EXPIRY = '60s';
// Impersonation access tokens are deliberately short-lived so a leaked one has
// a small blast radius. On expiry the session simply becomes unauthenticated
// and the admin is returned to login; the "Stop impersonating" control ends it
// immediately by re-issuing the admin's own session.
const IMPERSONATION_TOKEN_EXPIRY = '30m';

// HS256 (HMAC-SHA256) recommends secrets >= 32 bytes per RFC 7518 §3.2.
// `jose` does not enforce this itself, so we validate at boot to fail fast
// on weak/placeholder secrets.
const MIN_SECRET_BYTES = 32;

// Pin verification to HS256 so a token claiming any other alg (or `none`)
// cannot be tricked through. `jose` is hardened against alg-confusion but
// an explicit pin is best-practice defense-in-depth.
const ALLOWED_ALGORITHMS = ['HS256'];

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
  /**
   * Set only on impersonation tokens: the id of the platform admin acting as
   * `userId`. Its presence is what the app uses to render the impersonation
   * banner and to authorize "stop impersonating" (which re-issues a normal
   * session for this admin). Absent on ordinary sessions.
   */
  impersonatorId?: string;
  orgId: string;
  userId: string;
}

export interface RefreshTokenPayload {
  tokenId: string;
  userId: string;
}

export interface WsTicketPayload {
  orgId: string;
  userId: string;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(getSecret('JWT_SECRET'));
}

/**
 * Sign a short-lived impersonation access token. Identical in shape to a
 * normal access token (so the whole app treats the session as `userId` in
 * `orgId`) but carries the `impersonatorId` claim and a 30-minute lifetime.
 * No matching refresh token is issued — see `IMPERSONATION_TOKEN_EXPIRY`.
 */
export async function signImpersonationToken(payload: {
  orgId: string;
  userId: string;
  impersonatorId: string;
}): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(IMPERSONATION_TOKEN_EXPIRY)
    .sign(getSecret('JWT_SECRET'));
}

export async function signRefreshToken(payload: RefreshTokenPayload): Promise<string> {
  return new SignJWT({ ...payload, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(getSecret('JWT_REFRESH_SECRET'));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret('JWT_SECRET'), {
    algorithms: ALLOWED_ALGORITHMS,
  });

  if (payload.type !== 'access') {
    throw new Error('Invalid token type');
  }

  return {
    impersonatorId: typeof payload.impersonatorId === 'string' ? payload.impersonatorId : undefined,
    orgId: payload.orgId as string,
    userId: payload.userId as string,
  };
}

export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret('JWT_REFRESH_SECRET'), {
    algorithms: ALLOWED_ALGORITHMS,
  });

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
 * Sign a short-lived WebSocket ticket. Issued by `/api/auth/ws-ticket` from
 * a valid httpOnly access cookie and consumed by the WebSocket server. Lives
 * 60s so a leaked ticket has a tiny replay window; carries a narrow
 * `type: 'ws_ticket'` claim so it cannot be substituted for an access token.
 *
 * Returning a ticket (instead of the access token) means client JavaScript
 * never sees the long-lived bearer, preserving the httpOnly invariant.
 */
export async function signWsTicket(payload: WsTicketPayload): Promise<string> {
  return new SignJWT({ ...payload, type: 'ws_ticket' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(WS_TICKET_EXPIRY)
    .sign(getSecret('JWT_SECRET'));
}

export async function verifyWsTicket(token: string): Promise<WsTicketPayload> {
  const { payload } = await jwtVerify(token, getSecret('JWT_SECRET'), {
    algorithms: ALLOWED_ALGORITHMS,
  });

  if (payload.type !== 'ws_ticket') {
    throw new Error('Invalid token type');
  }

  return {
    orgId: payload.orgId as string,
    userId: payload.userId as string,
  };
}

// Shared JWT machinery for all OAuth "state" tokens (Google, GitHub, …).
// The `provider` claim discriminates tokens so a Google state cannot be
// presented as a GitHub state and vice-versa.
async function signOAuthStateJWT(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT({ ...claims, type: 'oauth_state' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_EXPIRY)
    .sign(getSecret('JWT_SECRET'));
}

async function verifyOAuthStateJWT(
  state: string,
  provider: string,
): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(state, getSecret('JWT_SECRET'), {
    algorithms: ALLOWED_ALGORITHMS,
  });
  if (payload.type !== 'oauth_state' || payload.provider !== provider) {
    throw new Error('Invalid OAuth state token');
  }
  return payload as Record<string, unknown>;
}

/**
 * Login-flow OAuth providers. `github_login` is deliberately distinct from
 * the `github` provider claim used by the org-integration connect flow
 * (`signGithubOAuthState` below) so an integration state can never be
 * presented as a login state or vice-versa.
 */
export type LoginOAuthProvider = 'google' | 'github_login';

/**
 * Sign a short-lived OAuth "state" JWT used to prevent CSRF on the
 * login OAuth redirect chain (Google, GitHub). The token carries a random
 * nonce and a narrow `type: 'oauth_state'` claim so it cannot be substituted
 * for an access/refresh token. Expires in 10 minutes — long enough for the
 * user to complete a consent screen, short enough to limit replay.
 */
export async function signOAuthState(
  provider: LoginOAuthProvider,
): Promise<{ state: string; nonce: string }> {
  const nonce = crypto.randomBytes(24).toString('base64url');
  const state = await signOAuthStateJWT({ nonce, provider });
  return { nonce, state };
}

export async function verifyOAuthState(state: string, provider: LoginOAuthProvider): Promise<void> {
  await verifyOAuthStateJWT(state, provider);
}

export interface GithubOAuthStatePayload {
  orgId: string;
  userId: string;
  webhookSecret: string;
}

/**
 * Sign the GitHub OAuth "state" param. Unlike the Google flow (where the
 * authenticated client re-supplies its own identity on callback), GitHub
 * redirects straight back to our server-side callback, so the state must
 * carry the initiating org/user and the webhook secret. Signing it with
 * `JWT_SECRET` makes it unforgeable — an attacker can no longer craft a
 * callback that binds an attacker-controlled `webhookSecret` (or a foreign
 * `orgId`) to a victim org. The 10-minute expiry bounds replay and the
 * narrow `type`/`provider` claims prevent substitution for another token.
 */
export async function signGithubOAuthState(payload: GithubOAuthStatePayload): Promise<string> {
  return signOAuthStateJWT({ ...payload, provider: 'github' });
}

export async function verifyGithubOAuthState(state: string): Promise<GithubOAuthStatePayload> {
  const payload = await verifyOAuthStateJWT(state, 'github');
  return {
    orgId: payload.orgId as string,
    userId: payload.userId as string,
    webhookSecret: payload.webhookSecret as string,
  };
}

export interface SlackOAuthStatePayload {
  orgId: string;
  userId: string;
}

/**
 * Sign the Slack OAuth "state" param. Like GitHub, Slack redirects to our
 * server-side callback, so the state carries the initiating org/user. Signed
 * with `JWT_SECRET` so a callback can't be forged to bind a foreign org.
 */
export async function signSlackOAuthState(payload: SlackOAuthStatePayload): Promise<string> {
  return signOAuthStateJWT({ ...payload, provider: 'slack' });
}

export async function verifySlackOAuthState(state: string): Promise<SlackOAuthStatePayload> {
  const payload = await verifyOAuthStateJWT(state, 'slack');
  return {
    orgId: payload.orgId as string,
    userId: payload.userId as string,
  };
}
