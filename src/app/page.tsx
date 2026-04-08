import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '../server/lib/prisma';

export default async function RootPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    redirect('/login');
  }

  let orgId: string | undefined;

  try {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not set');
    }
    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, secret);
    orgId = payload.orgId as string | undefined;
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

  redirect('/login');
}
