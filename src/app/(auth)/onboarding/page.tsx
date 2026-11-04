import { headers } from 'next/headers';
import { AuthHeader } from '@/components/auth/auth-header';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { getServerTranslations } from '@/lib/i18n/server';
import { titleMetadata } from '@/lib/page-metadata';

export async function generateMetadata() {
  return {
    ...(await titleMetadata('meta.createWorkspace')),
    robots: { follow: false, index: false },
  };
}

export default async function OnboardingPage() {
  const [{ t }, requestHeaders] = await Promise.all([getServerTranslations(), headers()]);
  // The workspace URL prefix is the host this deployment is actually served
  // from, not a hardcoded product domain.
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost';
  return (
    <div className="flex flex-col gap-6">
      <AuthHeader subtitle={t('auth.createWorkspaceSubtitle')} title={t('auth.createWorkspace')} />
      <OnboardingForm host={host} />
    </div>
  );
}
