import { OnboardingForm } from '@/components/auth/onboarding-form';
import { OnboardingHeader } from '@/components/auth/onboarding-header';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.createWorkspace')} — ${APP_NAME}` };
}

export default function OnboardingPage() {
  return (
    <div className="flex flex-col gap-6">
      <OnboardingHeader />
      <OnboardingForm />
    </div>
  );
}
