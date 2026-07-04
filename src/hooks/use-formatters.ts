'use client';

import { useMemo } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { DATE_FNS_LOCALES } from '@/lib/date-fns-locale';
import { INTL_LOCALES } from '@/lib/i18n';
import { formatDueDate as formatDueDateBase } from '@/lib/issue-utils';
import { formatRelativeTime as formatRelativeTimeBase } from '@/lib/utils';
import { useLocale } from '@/providers/locale-provider';

/**
 * Locale-bound date/time formatters. Collapses the repeated
 * `useLocale()` + `INTL_LOCALES[locale]` / `DATE_FNS_LOCALES[locale]` plumbing
 * (and the manual `t` threading through `formatRelativeTime`) into one hook so
 * a call site can't forget the locale and silently fall back to English.
 *
 * - `formatRelativeTime(dateStr)` — "5m ago" / "hace 5m", already translated.
 * - `formatDueDate(dueDate)` — short due-date label via `date-fns`.
 * - `formatDate(value, options?)` — locale-bound `toLocaleDateString`.
 * - `formatDateTime(value, options?)` — locale-bound `toLocaleString`.
 * - `intlLocale` / `dateFnsLocale` — escape hatches for direct `Intl` /
 *   `date-fns format()` calls (e.g. token-based formats in charts).
 */
export function useFormatters() {
  const t = useTranslations();
  const { locale } = useLocale();

  return useMemo(() => {
    const intlLocale = INTL_LOCALES[locale];
    const dateFnsLocale = DATE_FNS_LOCALES[locale];
    return {
      dateFnsLocale,
      formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
        new Date(value).toLocaleDateString(intlLocale, options),
      formatDateTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
        new Date(value).toLocaleString(intlLocale, options),
      formatDueDate: (dueDate: string | null | undefined) =>
        formatDueDateBase(dueDate, dateFnsLocale),
      formatRelativeTime: (dateStr: string) => formatRelativeTimeBase(dateStr, t, intlLocale),
      intlLocale,
    };
  }, [t, locale]);
}
