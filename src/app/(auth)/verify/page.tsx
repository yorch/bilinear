import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AuthHeader } from '@/components/auth/auth-header';
import { VerifyCodeForm } from '@/components/auth/verify-code-form';
import { getServerTranslations } from '@/lib/i18n/server';
import { titleMetadata } from '@/lib/page-metadata';

export async function generateMetadata() {
  // The URL can carry the address and a one-time code: keep it out of indexes.
  return { ...(await titleMetadata('meta.verify')), robots: { follow: false, index: false } };
}

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { email } = await searchParams;
  const address = typeof email === 'string' ? email.trim() : '';
  // Without an address there is nothing to verify the code against — a dead
  // end — so send the visitor back to the start.
  if (!address) {
    redirect('/login');
  }
  const { t } = await getServerTranslations();
  return (
    <div className="flex flex-col gap-6">
      <AuthHeader
        subtitle={t('auth.enterCodeSent', { email: address })}
        title={t('auth.checkYourEmail')}
      />
      <Suspense>
        <VerifyCodeForm />
      </Suspense>
    </div>
  );
}
