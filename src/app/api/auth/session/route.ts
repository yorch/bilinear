import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACCENT_COOKIE, ACCENT_COOKIE_MAX_AGE, isAccent } from '@/lib/accent';
import { verifyAccessToken, verifyRefreshToken } from '@/server/lib/jwt';
import { logger } from '@/server/lib/logger';
import { prisma } from '@/server/lib/prisma';
import {
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_MAX_AGE,
  setSessionCookie,
} from '@/server/lib/request-security';

export async function POST(req: NextRequest) {
  const body = await req.json();
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
  // do it). Best-effort — a failure here just means the default accent.
  //
  // Not httpOnly: `AccentProvider.setAccent` rewrites this cookie from the
  // client, and an httpOnly cookie of the same name would shadow that write.
  try {
    const user = await prisma.user.findUnique({
      select: { accent: true },
      where: { id: accessPayload.userId },
    });
    if (isAccent(user?.accent)) {
      res.cookies.set(ACCENT_COOKIE, user.accent, {
        httpOnly: false,
        maxAge: ACCENT_COOKIE_MAX_AGE,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to seed accent cookie from the user record');
  }

  return res;
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ success: true });
  res.cookies.delete('access_token');
  res.cookies.delete('refresh_token');
  return res;
}
