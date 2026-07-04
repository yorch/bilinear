import type { Locale as DateFnsLocale } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import type { Locale } from './i18n';

/** Maps an app `Locale` to a `date-fns` locale object for `format()` calls. */
export const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  en: enUS,
  es,
};
