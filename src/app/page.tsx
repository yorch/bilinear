import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '../server/lib/prisma';

export default async function RootPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    redirect('/login');
  }

  let orgId: string | undefined;

  try {
    const result = await verifyAccessToken(token);
    orgId = result.orgId || undefined;
  } catch {
    // Token invalid — redirect to login
    redirect('/login');
  }

  if (orgId) {
    // Look up the org's human-readable URL key so the workspace URL is stable.
    const org = await prisma.organization.findUnique({
      select: { urlKey: true },
      where: { id: orgId },
    });

    if (org?.urlKey) {
      redirect(`/${org.urlKey}`);
    }

    // Fallback to raw UUID if urlKey lookup fails
    redirect(`/${orgId}`);
  }

  // Authenticated but no org — send to onboarding
  redirect('/onboarding');
}
