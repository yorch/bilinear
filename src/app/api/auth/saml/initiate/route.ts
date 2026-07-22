import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import {
  SamlNotConfiguredError,
  SamlNotEnabledError,
  SamlService,
} from '@/server/services/saml.service';

const log = childLogger({ module: 'saml' });
const samlService = new SamlService(prisma);

// 5-minute relay state cookie TTL (seconds)
const RELAY_STATE_MAX_AGE = 5 * 60;

/**
 * GET /api/auth/saml/initiate?org=<urlKey>&redirect=<path>
 *
 * Builds a SAML AuthnRequest and redirects the browser to the IdP.
 * The org URL key and intended post-login redirect are stored in a
 * short-lived `saml_relay` cookie so the callback route can retrieve them.
 */
async function handleGet(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgKey = searchParams.get('org');
  const redirect = searchParams.get('redirect') ?? '/';

  if (!orgKey) {
    return NextResponse.json({ error: 'Missing org parameter' }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { urlKey: orgKey },
  });

  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  bindRequestContext({ orgId: org.id });

  const config = await samlService.getConfig(org.id);

  try {
    if (!config) {
      throw new SamlNotConfiguredError();
    }
    if (!config.enabled) {
      throw new SamlNotEnabledError();
    }
  } catch (err) {
    const message = (err as Error).message;
    log.warn({ orgId: org.id, orgKey }, message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const appUrl = env.APP_URL;
  const spEntityId = `${appUrl}/api/auth/saml/metadata?org=${orgKey}`;
  const acsUrl = `${appUrl}/api/auth/saml/callback`;

  // RelayState encodes the org key and redirect target so the callback can
  // route the user correctly after a successful assertion.
  const relayState = Buffer.from(JSON.stringify({ orgKey, redirect })).toString('base64url');

  const samlConfig = {
    emailAttribute: config.emailAttribute,
    idpCert: config.idpCert,
    idpEntityId: config.idpEntityId,
    idpSsoUrl: config.idpSsoUrl,
    jitProvisioning: config.jitProvisioning,
    nameAttribute: config.nameAttribute,
  };

  const idpRedirectUrl = samlService.buildAuthnRequest(samlConfig, spEntityId, acsUrl, relayState);

  log.info({ orgId: org.id, orgKey }, 'Redirecting to IdP for SAML SSO');

  const res = NextResponse.redirect(idpRedirectUrl, 302);

  // Store relayState in a cookie as a backup (some IdPs don't round-trip it)
  res.cookies.set('saml_relay', relayState, {
    httpOnly: true,
    maxAge: RELAY_STATE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return res;
}

export const GET = withRequestContext('auth/saml/initiate', handleGet);
