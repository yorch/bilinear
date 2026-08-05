import { Suspense } from 'react';
import { AuthHeader } from '@/components/auth/auth-header';
import { VerifyCodeForm } from '@/components/auth/verify-code-form';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.verify')} — ${APP_NAME}` };
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
