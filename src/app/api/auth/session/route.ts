import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken, verifyRefreshToken } from '@/server/lib/jwt';

const ACCESS_TOKEN_MAX_AGE = 60 * 60 * 24; // 24h in seconds
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30d in seconds

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

  return res;
}

export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({ success: true });
  res.cookies.delete('access_token');
  res.cookies.delete('refresh_token');
  return res;
}
