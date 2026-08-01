'use client';

import { useTranslations } from '@/hooks/use-translations';
import { APP_NAME } from '@/lib/app-config';

/**
 * The left half of the split sign-in layout.
 *
 * The auth pages were three stacked full-width buttons on an empty page with
 * no product framing at all — the least designed surface in the app, and the
 * first one anyone sees. This gives them a reason to exist beyond the form:
 * what the product is, and the one claim worth making on a sign-in screen.
 *
 * Hidden below `lg`, where the form should own the whole viewport rather than
 * compete with decoration.
 */
export function AuthCanvas() {
  const t = useTranslations();

  const stats = [
    { label: t('auth.canvas.statOfflineLabel'), value: t('auth.canvas.statOfflineValue') },
    { label: t('auth.canvas.statSyncLabel'), value: t('auth.canvas.statSyncValue') },
    { label: t('auth.canvas.statLocalesLabel'), value: t('auth.canvas.statLocalesValue') },
  ];

  return (
    <div className="relative hidden overflow-hidden border-r border-border bg-surface-sunken p-12 lg:flex lg:flex-col lg:justify-between">
      {/* Decorative — the field carries no information, so it is hidden from
          assistive tech entirely. */}
      <div aria-hidden="true" className="aurora-field">
        <i />
        <i />
        <i />
      </div>

      <div className="relative flex items-center gap-2.5">
        <span
          className="h-6 w-6 rounded-lg ring-1 ring-brand-border"
          style={{ backgroundImage: 'var(--gradient-brand)' }}
        />
        <span className="text-sm font-semibold tracking-tight text-foreground">{APP_NAME}</span>
      </div>

      <div className="relative">
        <h2 className="max-w-[14ch] text-3xl font-semibold leading-tight tracking-tight text-balance text-foreground">
          {t('auth.canvas.headline')}
        </h2>
        <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-foreground-secondary">
          {t('auth.canvas.subhead')}
        </p>
      </div>

      <dl className="relative flex gap-8">
        {stats.map(stat => (
          <div key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd className="font-mono text-xl font-semibold tracking-tight tabular-nums text-foreground">
              {stat.value}
            </dd>
            <p aria-hidden="true" className="mt-0.5 text-[11px] text-muted-foreground">
              {stat.label}
            </p>
          </div>
        ))}
      </dl>
    </div>
  );
}
