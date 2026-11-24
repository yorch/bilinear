import { redirect } from 'next/navigation';
import { AuthHeader } from '@/components/auth/auth-header';
import { LoginForm } from '@/components/auth/login-form';
import { getServerTranslations } from '@/lib/i18n/server';
import { titleMetadata } from '@/lib/page-metadata';
import { safeRelativePath } from '@/lib/safe-path';
import { getAuthProviderAvailability } from '@/server/lib/auth-providers';
import { getAppName } from '@/server/lib/branding';
import { readSessionClaim } from '@/server/lib/session-claim';

export const generateMetadata = () => titleMetadata('meta.signIn');

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // An already signed-in visitor has nothing to do here: send them on to where
  // they were headed (or the root, which resolves their workspace).
  if (await readSessionClaim()) {
    const { next } = await searchParams;
    redirect(safeRelativePath(Array.isArray(next) ? next[0] : next) ?? '/');
  }
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return (
    <div className="flex flex-col gap-6">
      <AuthHeader
        brandMark
        subtitle={t('auth.signInSubtitle')}
        title={t('auth.signInTitle', { appName })}
      />
      <LoginForm providers={getAuthProviderAvailability()} />
    </div>
  );
}
