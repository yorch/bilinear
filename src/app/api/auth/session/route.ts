import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACCENT_COOKIE, ACCENT_COOKIE_MAX_AGE, isAccent } from '@/lib/accent';
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/lib/i18n';
import { verifyAccessToken, verifyRefreshToken } from '@/server/lib/jwt';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import {
  ACCESS_TOKEN_MAX_AGE,
  isOriginAllowed,
  REFRESH_TOKEN_MAX_AGE,
  setSessionCookie,
} from '@/server/lib/request-security';

/**
 * Cookie-rewriting routes outside Apollo get no csrfPrevention, so they carry
 * their own guard. Without it a cross-site `<form enctype="text/plain">` can
 * post a JSON-shaped body here without a preflight and log the victim into
 * the attacker's account (login CSRF); the DELETE is an unauthenticated
 * logout-CSRF. Origin is checked against the same allow-list the GraphQL
 * route uses, and the POST additionally demands a JSON content type — a
 * plain form cannot send one.
 */
function refuseCrossSite(req: NextRequest): NextResponse | null {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const refused = refuseCrossSite(req);
  if (refused) {
    return refused;
  }
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { accessToken, refreshToken } = body as {
    accessToken: string;
    refreshToken: string;
  };

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Missing tokens' }, { status: 400 });
  }

  // Verify BOTH token signatures before trusting them into httpOnly cookies,
  // and confirm they belong to the same user. Verifying only the access token
  // (the prior behaviour) let a caller plant an arbitrary attacker-chosen
  // refresh_token alongside a valid access token (session-fixation surface).
  let accessPayload: Awaited<ReturnType<typeof verifyAccessToken>>;
  let refreshPayload: Awaited<ReturnType<typeof verifyRefreshToken>>;
  try {
    [accessPayload, refreshPayload] = await Promise.all([
      verifyAccessToken(accessToken),
      verifyRefreshToken(refreshToken),
    ]);
  } catch {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }
  if (accessPayload.userId !== refreshPayload.userId) {
    return NextResponse.json({ error: 'Token subject mismatch' }, { status: 400 });
  }

  const res = NextResponse.json({ success: true });
  setSessionCookie(res, 'access_token', accessToken, ACCESS_TOKEN_MAX_AGE);
  setSessionCookie(res, 'refresh_token', refreshToken, REFRESH_TOKEN_MAX_AGE);

  // Seed the accent cookie from the account so the preference follows the user
  // to a new browser or device. This is the ONLY place the column is read:
  // doing it at login keeps it off the hot path (the root layout resolves the
  // accent from the cookie on every request, and must not hit the database to
  // do it).
  //
  // The cookie is rewritten on EVERY session install, including the clear —
  // this route is where one account's session replaces another's on a shared
  // browser, and a cookie that is only ever written when the incoming user has
  // a stored accent would leave the previous user's choice in place. A user
  // with no stored accent gets the default, not their predecessor's.
  //
  // Not httpOnly: `AccentProvider.setAccent` rewrites this cookie from the
  // client, and an httpOnly cookie of the same name would shadow that write.
  //
  // `locale` rides along on the same read for the same reason: it is a
  // per-account preference, and without this seeding it was write-only —
  // `LocaleProvider.setLocale` persisted it so transactional emails matched the
  // chosen language, but nothing ever read the column back for the UI, so the
  // user's language did NOT follow them to a new browser or device. Clearing it
  // (rather than defaulting to `en`) is what lets `getServerLocale` fall through
  // to the visitor's `Accept-Language`.
  let accent: string | null = null;
  let locale: string | null = null;
  try {
    const user = await prisma.user.findUnique({
      select: { accent: true, locale: true },
      where: { id: accessPayload.userId },
    });
    accent = isAccent(user?.accent) ? user.accent : null;
    locale = isLocale(user?.locale) ? user.locale : null;
  } catch (err) {
    // Best-effort: fall through to the clear, so a transient DB failure lands
    // on the default rather than on whoever used this browser last.
    logger.warn({ err }, 'Failed to read the accent/locale preferences from the user record');
  }
  writeAccentCookie(res, accent);
  writeLocaleCookie(res, locale);

  return res;
}

export async function DELETE(req: NextRequest) {
  const refused = refuseCrossSite(req);
  if (refused) {
    return refused;
  }
  const res = NextResponse.json({ success: true });
  res.cookies.delete('access_token');
  res.cookies.delete('refresh_token');
  // Accent and locale are per-account preferences, so they go with the session.
  // Left behind, they would style — and translate — the login screen, and then
  // the next account, for the departing user.
  writeAccentCookie(res, null);
  writeLocaleCookie(res, null);
  return res;
}

/** Sets the accent cookie, or clears it when `accent` is null. */
function writeAccentCookie(res: NextResponse, accent: string | null) {
  res.cookies.set(ACCENT_COOKIE, accent ?? '', {
    httpOnly: false,
    maxAge: accent ? ACCENT_COOKIE_MAX_AGE : 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Sets the locale cookie, or clears it when `locale` is null. Not httpOnly, for
 * the same reason as the accent cookie: `LocaleProvider.setLocale` rewrites it
 * from the client, and an httpOnly cookie of the same name would shadow that.
 */
function writeLocaleCookie(res: NextResponse, locale: string | null) {
  res.cookies.set(LOCALE_COOKIE, locale ?? '', {
    httpOnly: false,
    maxAge: locale ? LOCALE_COOKIE_MAX_AGE : 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}
