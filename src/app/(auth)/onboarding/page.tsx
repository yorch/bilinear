import { AuthHeader } from '@/components/auth/auth-header';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { getServerTranslations } from '@/lib/i18n/server';
import { getAppName } from '@/server/lib/branding';

export async function generateMetadata() {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return { title: `${t('meta.createWorkspace')} — ${appName}` };
}

export default async function OnboardingPage() {
  const { t } = await getServerTranslations();
  return (
    <div className="flex flex-col gap-6">
      <AuthHeader subtitle={t('auth.createWorkspaceSubtitle')} title={t('auth.createWorkspace')} />
      <OnboardingForm />
    </div>
  );
}
