import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
import { childLogger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { getClientIp } from '@/server/lib/request-security';
import { checkFixedWindow } from '@/server/middleware/rate-limit';
import { SamlService } from '@/server/services/saml.service';

// A well-formed UUID no organization has, so a miss costs the same query.
const NO_ORG_ID = '00000000-0000-0000-0000-000000000000';

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
/**
 * Every "SSO can't start for this workspace" outcome — unknown key, SAML never
 * configured, SAML switched off — collapses into this one response, after the
 * same lookups and a fixed minimum latency, so the route is not an oracle for
 * which workspaces exist or how they are set up. A client probe (`probe=1`,
 * used by the sign-in page's fetch) gets a bare 404 it can tell apart from the
 * IdP redirect; a plain navigation lands back on /login with the message.
 */
const MIN_RESPONSE_MS = 300;
const INITIATE_PER_MINUTE = 20;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function unavailable(req: NextRequest, probe: boolean): NextResponse {
  if (probe) {
    return NextResponse.json({ error: 'SSO unavailable' }, { status: 404 });
  }
  return NextResponse.redirect(new URL('/login?sso=unavailable', req.url), 302);
}

async function handleGet(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgKey = searchParams.get('org');
  const redirect = searchParams.get('redirect') ?? '/';
  const probe = searchParams.get('probe') === '1';
  const startedAt = Date.now();

  const ip = getClientIp(req);
  if (ip) {
    const { exceeded } = await checkFixedWindow(`rl:saml-initiate:${ip}`, INITIATE_PER_MINUTE, 60);
    if (exceeded) {
      return NextResponse.json(
        { error: 'Too many attempts — try again in a minute' },
        { headers: { 'Retry-After': '60' }, status: 429 },
      );
    }
  }

  const org = orgKey ? await prisma.organization.findUnique({ where: { urlKey: orgKey } }) : null;
  if (org) {
    bindRequestContext({ orgId: org.id });
  }
  const config = await samlService.getConfig(org?.id ?? NO_ORG_ID);

  if (!orgKey || !org || !config?.enabled) {
    if (org) {
      log.warn({ orgId: org.id, orgKey }, config ? 'SAML not enabled' : 'SAML not configured');
    }
    const wait = MIN_RESPONSE_MS - (Date.now() - startedAt);
    if (wait > 0) {
      await sleep(wait);
    }
    return unavailable(req, probe);
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
