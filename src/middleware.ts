import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/verify',
  '/api/graphql',
  '/auth/google',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token =
    req.cookies.get('access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete('access_token');
    res.cookies.delete('refresh_token');
    return res;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
