'use client';

import { Languages } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { type Locale, locales } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useLocale } from '@/providers/locale-provider';

const CYCLE: Record<Locale, Locale> = {
  en: 'es',
  es: 'en',
};

interface LanguageToggleProps {
  className?: string;
  /** Render a single icon button that cycles through languages. For compact spaces (e.g. collapsed sidebar). */
  compact?: boolean;
}

/**
 * Two-way toggle: English / Español.
 * Pass `compact` to render a single cycling icon button instead.
 */
export function LanguageToggle({ className, compact = false }: LanguageToggleProps) {
  const { locale, setLocale } = useLocale();
  const t = useTranslations();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const label = (l: Locale) => (l === 'en' ? t('language.english') : t('language.spanish'));

  if (compact) {
    const current = mounted ? locale : 'en';
    return (
      <button
        aria-label={t('language.currentLanguage', { language: label(current) })}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50',
          className,
        )}
        onClick={() => setLocale(CYCLE[current])}
        title={t('language.currentLanguage', { language: label(current) })}
        type="button"
      >
        <Languages className="h-4 w-4" />
      </button>
    );
  }

  return (
    <fieldset
      className={cn(
        'flex items-center gap-0.5 rounded-md bg-zinc-100 p-0.5 dark:bg-zinc-800 border-0 m-0',
        className,
      )}
    >
      <legend className="sr-only">{t('language.language')}</legend>
      {locales.map(l => (
        <button
          aria-pressed={mounted ? locale === l : undefined}
          className={cn(
            'flex h-6 items-center justify-center rounded px-1.5 text-[11px] font-medium transition-colors',
            mounted && locale === l
              ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50'
              : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200',
          )}
          key={l}
          onClick={() => setLocale(l)}
          title={label(l)}
          type="button"
        >
          {l.toUpperCase()}
        </button>
      ))}
    </fieldset>
  );
}
