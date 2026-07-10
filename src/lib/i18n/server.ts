import { cookies, headers } from 'next/headers';
import {
  defaultLocale,
  isLocale,
  LOCALE_COOKIE,
  pickLocaleFromAcceptLanguage,
  translate,
} from './index';

/**
 * Server-only: resolve the active locale. An explicit choice (the `locale`
 * cookie, written by `LocaleProvider.setLocale`) always wins. First-time
 * visitors with no cookie yet fall back to their browser's `Accept-Language`
 * preference, then to the app default.
 */
export async function getServerLocale() {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) {
    return cookieLocale;
  }
  const acceptLanguage = (await headers()).get('accept-language');
  return pickLocaleFromAcceptLanguage(acceptLanguage) ?? defaultLocale;
}

/**
 * Server-only `t()` for `generateMetadata` and other server-only contexts.
 * Uses the same `translate()` core as the client hook so key resolution,
 * English fallback, and `{placeholder}` interpolation match exactly.
 */
export async function getServerTranslations() {
  const locale = await getServerLocale();
  return {
    locale,
    t: (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
  };
}
