import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function RootPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;

  if (!token) {
    redirect('/login');
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
    const { payload } = await jwtVerify(token, secret);
    const orgId = payload.orgId as string | undefined;

    if (orgId) {
      // In a future sprint the orgId will map to a urlKey; for now redirect to workspace
      redirect(`/${orgId}`);
    }
  } catch {
    // Token invalid — middleware will handle redirect, but redirect here as fallback
  }

  redirect('/login');
}
