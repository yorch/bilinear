'use client';

import { useTranslations } from '@/hooks/use-translations';

export function OnboardingHeader() {
  const t = useTranslations();
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        {t('auth.createWorkspace')}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('auth.createWorkspaceSubtitle')}</p>
    </div>
  );
}
