'use client';

import { useTranslations } from '@/hooks/use-translations';
import { APP_NAME } from '@/lib/app-config';

export function LoginHeader() {
  const t = useTranslations();
  return (
    <div className="flex flex-col gap-1">
      {/* The canvas carries the brand mark at `lg`+; below that it is hidden,
          so the form has to introduce the product itself. */}
      <div className="mb-4 flex items-center gap-2.5 lg:hidden">
        <span
          className="h-6 w-6 rounded-lg ring-1 ring-brand-border"
          style={{ backgroundImage: 'var(--gradient-brand)' }}
        />
        <span className="text-sm font-semibold tracking-tight text-foreground">{APP_NAME}</span>
      </div>
      <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
        {t('auth.signInTitle', { appName: APP_NAME })}
      </h1>
      <p className="text-sm text-muted-foreground">{t('auth.signInSubtitle')}</p>
    </div>
  );
}
