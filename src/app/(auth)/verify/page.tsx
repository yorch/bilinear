import { Suspense } from 'react';
import { VerifyCodeForm } from '@/components/auth/verify-code-form';
import { VerifyHeader } from '@/components/auth/verify-header';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.verify')} — ${APP_NAME}` };
}

export default function VerifyPage() {
  return (
    <div className="flex flex-col gap-6">
      <VerifyHeader />
      <Suspense>
        <VerifyCodeForm />
      </Suspense>
    </div>
  );
}
