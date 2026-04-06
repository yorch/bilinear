import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

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
