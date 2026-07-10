'use client';

import { useTranslations } from '@/hooks/use-translations';
import { APP_NAME } from '@/lib/app-config';

export function LoginHeader() {
  const t = useTranslations();
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t('auth.signInTitle', { appName: APP_NAME })}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('auth.signInSubtitle')}</p>
    </div>
  );
}
