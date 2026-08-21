import { Suspense } from 'react';
import { AuthHeader } from '@/components/auth/auth-header';
import { VerifyCodeForm } from '@/components/auth/verify-code-form';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';

export async function generateMetadata() {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t('meta.verify')} — ${appName}` };
}

export default async function VerifyPage() {
  const { t } = await getServerTranslations();
  return (
    <div className="flex flex-col gap-6">
      <AuthHeader subtitle={t('auth.enterCode')} title={t('auth.checkYourEmail')} />
      <Suspense>
        <VerifyCodeForm />
      </Suspense>
    </div>
  );
}
