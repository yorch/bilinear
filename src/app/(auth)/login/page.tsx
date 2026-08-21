import { AuthHeader } from '@/components/auth/auth-header';
import { LoginForm } from '@/components/auth/login-form';
import { getServerTranslations } from '@/lib/i18n/server';
import { titleMetadata } from '@/lib/page-metadata';
import { getAppName } from '@/server/lib/branding';

export const generateMetadata = () => titleMetadata('meta.signIn');

export default async function LoginPage() {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return (
    <div className="flex flex-col gap-6">
      <AuthHeader
        brandMark
        subtitle={t('auth.signInSubtitle')}
        title={t('auth.signInTitle', { appName })}
      />
      <LoginForm />
    </div>
  );
}
