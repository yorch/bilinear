import { AuthHeader } from '@/components/auth/auth-header';
import { OnboardingForm } from '@/components/auth/onboarding-form';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.createWorkspace')} — ${APP_NAME}` };
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
