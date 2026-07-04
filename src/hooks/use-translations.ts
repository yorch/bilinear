'use client';

import { useCallback } from 'react';
import { translate } from '@/lib/i18n';
import { useLocale } from '@/providers/locale-provider';

/**
 * Returns a `t(key, params?)` function that resolves a dotted key (e.g. "nav.myIssues")
 * against the active locale's dictionary, falling back to English, then the key itself.
 * `{placeholder}` tokens in the string are replaced from `params`.
 */
export function useTranslations() {
  const { locale } = useLocale();
  return useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
}
