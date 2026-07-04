import { LoginForm } from '@/components/auth/login-form';
import { LoginHeader } from '@/components/auth/login-header';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getServerTranslations();
  return { title: `${t('meta.signIn')} — ${APP_NAME}` };
}

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-6">
      <LoginHeader />
      <LoginForm />
    </div>
  );
}
