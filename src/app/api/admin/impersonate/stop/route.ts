import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { bindRequestContext, withRequestContext } from '@/server/lib/request-context';
import {
  ACCESS_TOKEN_MAX_AGE,
  getClientIp,
  isOriginAllowed,
  REFRESH_TOKEN_MAX_AGE,
  setSessionCookie,
} from '@/server/lib/request-security';
import { AuthService } from '@/server/services/auth.service';
import { PlatformAdminService } from '@/server/services/platform-admin.service';
import { UserService } from '@/server/services/user.service';

/**
 * End impersonation and restore the platform admin's own session. The
 * impersonator's identity comes from the `impersonatorId` claim inside the
 * current impersonation token — read directly via `verifyAccessToken` rather
 * than `extractAuthContext`, so the admin can always exit even if the
 * impersonated target was suspended mid-session (which would otherwise null
 * out the context and strip the claim). We re-verify the impersonator still
 * carries the platform-admin flag before minting fresh admin tokens.
 */
async function handlePost(req: NextRequest) {
  if (!isOriginAllowed(req)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const cookieToken = req.cookies.get('access_token')?.value ?? null;
  let impersonatorId: string | undefined;
  let targetUserId: string | undefined;
  if (cookieToken) {
    try {
      const payload = await verifyAccessToken(cookieToken);
      impersonatorId = payload.impersonatorId;
      targetUserId = payload.userId;
    } catch {
      // fall through — treated as "not impersonating"
    }
  }

  if (!impersonatorId) {
    return NextResponse.json({ error: 'Not impersonating' }, { status: 400 });
  }

  const admin = await prisma.user.findUnique({
    select: { isPlatformAdmin: true },
    where: { id: impersonatorId },
  });
  if (!admin?.isPlatformAdmin) {
    return NextResponse.json({ error: 'Original account is no longer an admin' }, { status: 403 });
  }
  bindRequestContext({ userId: impersonatorId });

  const userService = new UserService(prisma);
  const authService = new AuthService(prisma, userService);
  const org = await userService.getOrganizationForUser(impersonatorId);
  const pair = await authService.reissueTokens(impersonatorId, org?.id ?? '');

  void new PlatformAdminService(prisma).recordAudit({
    action: 'user.impersonation_ended',
    actorId: impersonatorId,
    ipAddress: getClientIp(req),
    targetId: targetUserId ?? null,
    targetType: 'User',
  });

  const res = NextResponse.json({ success: true });
  setSessionCookie(res, 'access_token', pair.accessToken, ACCESS_TOKEN_MAX_AGE);
  setSessionCookie(res, 'refresh_token', pair.refreshToken, REFRESH_TOKEN_MAX_AGE);
  return res;
}

export const POST = withRequestContext('admin/impersonate/stop', handlePost);
