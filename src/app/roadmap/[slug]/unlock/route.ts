import { type NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';
import { getClientIp } from '@/server/lib/request-security';
import {
  isValidRoadmapSlug,
  MAX_ROADMAP_PASSWORD_LENGTH,
  ROADMAP_UNLOCK_TTL_SECONDS,
  RoadmapService,
  roadmapUnlockCookieName,
  roadmapUnlockToken,
} from '@/server/services/roadmap.service';

/**
 * Redirects are relative: the browser resolves them against the origin it
 * actually used, so the unlock cookie (host-scoped) reaches the page whatever
 * host or proxy headers the server sees. `request.url` carries the server's own
 * host and must not be used to build the Location.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { headers: { Location: path }, status: 303 });
}

/**
 * POST target of the public roadmap's password form. The password travels in
 * the request body (never the URL); on success an httpOnly cookie proves it on
 * later requests, and the visitor is redirected back to the roadmap.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!isValidRoadmapSlug(slug)) {
    return redirectTo('/');
  }
  const back = `/roadmap/${slug}`;

  const form = await request.formData().catch(() => null);
  const password = form?.get('password');
  const roadmap = await prisma.publicRoadmap.findUnique({ where: { slug } });

  if (!roadmap?.enabled || !roadmap.passwordHash || typeof password !== 'string' || !password) {
    return redirectTo(back);
  }
  if (password.length > MAX_ROADMAP_PASSWORD_LENGTH) {
    return redirectTo(`${back}?error=1`);
  }

  const service = new RoadmapService(prisma);
  if (await service.isPasswordAttemptLimited(roadmap.id, getClientIp(request))) {
    return redirectTo(`${back}?error=rate`);
  }
  if (!(await service.verifyPassword(roadmap, password))) {
    return redirectTo(`${back}?error=1`);
  }

  const response = redirectTo(back);
  response.cookies.set(
    roadmapUnlockCookieName(slug),
    roadmapUnlockToken(slug, roadmap.passwordHash),
    {
      httpOnly: true,
      maxAge: ROADMAP_UNLOCK_TTL_SECONDS,
      path: back,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  );
  return response;
}
