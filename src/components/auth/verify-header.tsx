'use client';

import { useTranslations } from '@/hooks/use-translations';

export function VerifyHeader() {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
        {t('auth.checkYourEmail')}
      </h1>
      <p className="text-sm text-muted-foreground">{t('auth.enterCode')}</p>
    </div>
  );
}
