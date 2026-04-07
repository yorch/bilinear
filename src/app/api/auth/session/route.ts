import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';

const ACCESS_TOKEN_MAX_AGE = 60 * 60 * 24; // 24h in seconds
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 30; // 30d in seconds

/**
 * GET /api/auth/session
 * Returns the current access token so client-side code can pass it to the
 * WebSocket server (which cannot use httpOnly cookies).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('access_token')?.value ?? null;
  if (!token) {
    return NextResponse.json({ token: null }, { status: 200 });
  }

  try {
    await verifyAccessToken(token);
    return NextResponse.json({ token }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ token: null }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { accessToken, refreshToken } = body as {
    accessToken: string;
    refreshToken: string;
  };

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Missing tokens' }, { status: 400 });
  }

  // Verify the access token signature before trusting it into a cookie.
  // Rejects tokens that weren't signed by this server's JWT_SECRET.
  try {
    await verifyAccessToken(accessToken);
  } catch {
    return NextResponse.json(
      { error: 'Invalid access token' },
      { status: 400 },
    );
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
