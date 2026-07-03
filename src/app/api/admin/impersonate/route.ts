import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { signImpersonationToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import { getClientIp, isOriginAllowed, setSessionCookie } from '@/server/lib/request-security';
import { extractAuthContext } from '@/server/middleware/auth';
import {
  ImpersonationTargetError,
  PlatformAdminService,
} from '@/server/services/platform-admin.service';

// Impersonation token lives 30 minutes (mirrors IMPERSONATION_TOKEN_EXPIRY).
const IMPERSONATION_COOKIE_MAX_AGE = 30 * 60;

/**
 * Begin impersonation. A platform admin exchanges a target userId (+ optional
 * orgId) for a short-lived access token scoped to that user, and we swap it
 * into the `access_token` cookie. The admin's own `refresh_token` cookie is
 * left untouched so the "stop" flow (and a fresh login after the short token
 * lapses) still work.
 */
async function handlePost(req: NextRequest) {
  // These cookie-rewriting routes bypass Apollo, so they don't inherit its
  // csrfPrevention/Origin allow-list — apply the same Origin guard here.
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('access_token')?.value ?? null;
  const auth = await extractAuthContext(authHeader, cookieToken, prisma);

  if (!auth.userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  // A session that is already impersonating cannot start a nested impersonation.
  if (auth.impersonatorId) {
    return NextResponse.json({ error: 'Already impersonating' }, { status: 403 });
  }

  const admin = await prisma.user.findUnique({
    select: { isPlatformAdmin: true },
    where: { id: auth.userId },
  });
  if (!admin?.isPlatformAdmin) {
    return NextResponse.json({ error: 'Platform admin access required' }, { status: 403 });
  }
  bindRequestContext({ userId: auth.userId });

  let body: { userId?: string; orgId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  if (!body.userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }
  // Refuse to impersonate yourself — no reason to, and it would obscure the
  // banner/exit logic which keys off a distinct impersonatorId.
  if (body.userId === auth.userId) {
    return NextResponse.json({ error: 'Cannot impersonate yourself' }, { status: 400 });
  }

  const service = new PlatformAdminService(prisma);
  let target: Awaited<ReturnType<PlatformAdminService['resolveImpersonationTarget']>>;
  try {
    target = await service.resolveImpersonationTarget(body.userId, body.orgId ?? null);
  } catch (err) {
    if (err instanceof ImpersonationTargetError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const token = await signImpersonationToken({
    impersonatorId: auth.userId,
    orgId: target.org.id,
    userId: target.user.id,
  });

  void service.recordAudit({
    action: 'user.impersonated',
    actorId: auth.userId,
    ipAddress: getClientIp(req),
    metadata: { orgId: target.org.id, orgUrlKey: target.org.urlKey },
    targetId: target.user.id,
    targetType: 'User',
  });

  const res = NextResponse.json({ success: true, urlKey: target.org.urlKey });
  setSessionCookie(res, 'access_token', token, IMPERSONATION_COOKIE_MAX_AGE);
  return res;
}

export const POST = withRequestContext('admin/impersonate', handlePost);
