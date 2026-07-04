'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';
import { USER_UPDATE_LOCALE_MUTATION } from '@/lib/graphql-queries';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API isn't broadly supported yet; this is a simple, short-lived preference cookie
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Persist to the account so transactional emails (which never see the
    // cookie) match the chosen language. Fire-and-forget, but don't swallow
    // everything: UNAUTHENTICATED is expected on the pre-login pages
    // (login/verify) and ignored, while any other failure is logged so a
    // silently stale locale (and thus wrong-language emails) is diagnosable.
    void gql(USER_UPDATE_LOCALE_MUTATION, { locale: next })
      .then(res => {
        const errors = res?.errors;
        if (!errors?.length) {
          return;
        }
        const onlyUnauthenticated = errors.every(
          err =>
            (err as { extensions?: { code?: string } })?.extensions?.code === 'UNAUTHENTICATED',
        );
        if (!onlyUnauthenticated) {
          console.warn('Failed to persist locale preference', errors);
        }
      })
      .catch(err => console.warn('Failed to persist locale preference', err));
  }, []);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}
