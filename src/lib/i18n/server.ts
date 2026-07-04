import { cookies } from 'next/headers';
import { defaultLocale, isLocale, LOCALE_COOKIE, translate } from './index';

/** Server-only: resolve the active locale from the request's `locale` cookie. */
export async function getServerLocale() {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(cookieLocale) ? cookieLocale : defaultLocale;
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
