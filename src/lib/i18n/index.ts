import en from './locales/en.json';
import es from './locales/es.json';

export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

export const dictionaries = { en, es } satisfies Record<Locale, unknown>;

export type Dictionary = typeof en;

export const LOCALE_COOKIE = 'locale';

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

/** Resolve a dotted key (e.g. "nav.myIssues") against a dictionary. */
function getPath(dict: Dictionary, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);
}

/**
 * Core translation lookup shared by the client `useTranslations()` hook and the
 * server `getServerTranslations()` helper so both resolve keys, fall back to
 * English, and interpolate `{placeholder}` tokens identically.
 *
 * The replacement is passed as a function so `String.prototype.replaceAll`
 * treats `$`-sequences in user-supplied values (issue titles, entity names)
 * literally instead of as special replacement patterns.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const raw =
    getPath(dictionaries[locale], key) ?? getPath(dictionaries[defaultLocale], key) ?? key;
  let value = typeof raw === 'string' ? raw : key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, () => String(replacement));
    }
  }
  return value;
}

/** Maps an app `Locale` to a BCP 47 tag for `Intl`/`toLocaleDateString` calls. */
export const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-ES',
};
