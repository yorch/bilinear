import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/admin-shell';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';

export const metadata = { title: 'Platform Admin' };

/**
 * Server-side guard for the platform console. Everything under `(admin)` is
 * gated here: the caller must present a valid access token, must NOT be
 * impersonating (an impersonated session can never reach the console), and
 * must carry the global `isPlatformAdmin` flag. Anyone else is bounced to the
 * app root. This runs before any admin page renders.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    redirect('/login');
  }

  let payload: Awaited<ReturnType<typeof verifyAccessToken>> | null = null;
  try {
    payload = await verifyAccessToken(token);
  } catch {
    payload = null;
  }

  if (!payload) {
    redirect('/login');
  }
  // Impersonated sessions are locked out of the console entirely.
  if (payload.impersonatorId) {
    redirect('/');
  }

  const user = await prisma.user.findUnique({
    select: { active: true, displayName: true, email: true, isPlatformAdmin: true },
    where: { id: payload.userId },
  });

  if (!user?.active || !user.isPlatformAdmin) {
    redirect('/');
  }

  return <AdminShell adminEmail={user.email}>{children}</AdminShell>;
}
