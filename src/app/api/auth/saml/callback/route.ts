import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACCESS_TOKEN_EXPIRY_SECONDS, signAccessToken, signRefreshToken } from '@/server/lib/jwt';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { AuditLogService } from '@/server/services/audit-log.service';
import { SamlService } from '@/server/services/saml.service';

const log = childLogger({ module: 'saml', route: 'callback' });
const samlService = new SamlService(prisma);
const auditLogService = new AuditLogService(prisma);

const ACCESS_TOKEN_MAX_AGE = ACCESS_TOKEN_EXPIRY_SECONDS; // 24h
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30d
const REFRESH_TOKEN_DAYS = 30;

/**
 * POST /api/auth/saml/callback
 *
 * Receives the SAML Response from the IdP (HTTP-POST binding).
 * Parses and validates the assertion, JIT-provisions the user if needed,
 * issues JWT access + refresh tokens, and sets httpOnly cookies before
 * redirecting to the workspace.
 */
export async function POST(req: NextRequest) {
  let samlResponse: string | null = null;
  let relayState: string | null = null;

  try {
    const formData = await req.formData();
    samlResponse = formData.get('SAMLResponse') as string | null;
    relayState =
      (formData.get('RelayState') as string | null) ?? req.cookies.get('saml_relay')?.value ?? null;
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  if (!samlResponse) {
    return NextResponse.json({ error: 'Missing SAMLResponse' }, { status: 400 });
  }

  // Decode relay state to get org key and redirect target
  let orgKey: string;
  let redirectPath: string = '/';

  if (relayState) {
    try {
      const decoded = JSON.parse(Buffer.from(relayState, 'base64url').toString('utf8')) as {
        orgKey?: string;
        redirect?: string;
      };
      orgKey = decoded.orgKey ?? '';
      redirectPath = decoded.redirect ?? '/';
    } catch {
      return NextResponse.json({ error: 'Invalid relay state' }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: 'Missing relay state' }, { status: 400 });
  }

  if (!orgKey) {
    return NextResponse.json({ error: 'Missing org key in relay state' }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { urlKey: orgKey },
  });

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const config = await samlService.getConfig(org.id);
  if (!config?.enabled) {
    return NextResponse.json({ error: 'SAML SSO is not enabled' }, { status: 400 });
  }

  const samlConfig = {
    emailAttribute: config.emailAttribute,
    idpCert: config.idpCert,
    idpEntityId: config.idpEntityId,
    idpSsoUrl: config.idpSsoUrl,
    jitProvisioning: config.jitProvisioning,
    nameAttribute: config.nameAttribute,
  };

  let claims: Awaited<ReturnType<SamlService['parseAndValidateResponse']>>;
  try {
    claims = await samlService.parseAndValidateResponse(samlConfig, samlResponse);
  } catch (err) {
    const message = (err as Error).message;
    log.warn({ message, orgId: org.id }, 'SAML response parse error');
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!config.jitProvisioning) {
    // Without JIT, the user must already exist
    const existing = await prisma.user.findUnique({ where: { email: claims.email } });
    if (!existing) {
      log.warn(
        { email: claims.email, orgId: org.id },
        'SSO login rejected — JIT disabled and user not found',
      );
      return NextResponse.json(
        { error: 'User not found. Contact your administrator.' },
        { status: 403 },
      );
    }
  }

  const { userId } = await samlService.jitProvisionUser(prisma, org.id, claims);

  // Issue JWT token pair (mirrors AuthService.issueTokenPair)
  const tokenId = crypto.randomUUID();
  const familyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ orgId: org.id, userId }),
    signRefreshToken({ tokenId, userId }),
  ]);

  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await prisma.authToken.create({
    data: {
      expiresAt,
      familyId,
      id: tokenId,
      tokenHash,
      type: 'refresh',
      userId,
    },
  });

  log.info({ orgId: org.id, userId }, 'SAML SSO login successful');

  void auditLogService.log({
    action: 'auth.login',
    ipAddress: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
    metadata: { idpEntityId: config.idpEntityId, method: 'saml' },
    orgId: org.id,
    userAgent: req.headers.get('user-agent') ?? undefined,
    userId,
  });

  // Sanitize redirect to prevent open redirect
  const safeRedirect = redirectPath.startsWith('/') ? redirectPath : `/${orgKey}`;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const destination = `${appUrl}${safeRedirect}`;

  const res = NextResponse.redirect(destination, 302);

  res.cookies.set('access_token', accessToken, {
    httpOnly: true,
    maxAge: ACCESS_TOKEN_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  res.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    maxAge: REFRESH_TOKEN_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  // Clear the relay state cookie
  res.cookies.delete('saml_relay');

  return res;
}
