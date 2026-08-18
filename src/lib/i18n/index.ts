import en from './locales/en.json';
import es from './locales/es.json';

export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const dictionaries = { en, es } satisfies Record<Locale, unknown>;

export type Dictionary = typeof en;

export const LOCALE_COOKIE = 'locale';

/** One year, matching the accent cookie. */
export const LOCALE_COOKIE_MAX_AGE = 31536000;

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
 * `Intl.PluralRules` is cheap to reuse but not free to construct, so memoize
 * one instance per locale for the plural-category lookups in `translate()`.
 */
const pluralRulesCache = new Map<Locale, Intl.PluralRules>();

/**
 * Locale-aware number formatter for the `{count}` placeholder, memoized per
 * locale (constructing `Intl.NumberFormat` is not free and this runs on the
 * hot list/board render path). Ensures large counts get the locale's grouping
 * separators (e.g. `1.500` in `es`, `1,500` in `en`).
 */
const numberFormatCache = new Map<Locale, Intl.NumberFormat>();
function numberFormatFor(locale: Locale): Intl.NumberFormat {
  let fmt = numberFormatCache.get(locale);
  if (!fmt) {
    fmt = new Intl.NumberFormat(INTL_LOCALES[locale]);
    numberFormatCache.set(locale, fmt);
  }
  return fmt;
}

function pluralRulesFor(locale: Locale): Intl.PluralRules {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(INTL_LOCALES[locale]);
    pluralRulesCache.set(locale, rules);
  }
  return rules;
}

/**
 * Resolve a pluralized key. When a `count` is in play, a key `foo.bar` is
 * represented by CLDR-category siblings (`foo.bar_one`, `foo.bar_other`, and
 * for locales that need them `_zero`/`_two`/`_few`/`_many`). We pick the
 * category via `Intl.PluralRules`, fall back to `_other`, and — so plain
 * (non-pluralized) keys keep working unchanged — return `null` when no
 * suffixed variant exists, letting the caller fall through to a direct lookup.
 */
function resolvePluralRaw(locale: Locale, key: string, count: number): string | null {
  const category = pluralRulesFor(locale).select(count);
  // Exhaust the target locale's own forms (selected category, then `_other`)
  // BEFORE crossing to the default locale — otherwise a locale that lacks the
  // selected CLDR category but has `_other` would render the English form
  // mid-sentence instead of its own fallback.
  for (const dict of [dictionaries[locale], dictionaries[defaultLocale]]) {
    for (const cat of [category, 'other']) {
      const raw = getPath(dict, `${key}_${cat}`);
      if (typeof raw === 'string') {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Core translation lookup shared by the client `useTranslations()` hook and the
 * server `getServerTranslations()` helper so both resolve keys, fall back to
 * English, and interpolate `{placeholder}` tokens identically.
 *
 * When `params.count` is a number, the key is first resolved through the CLDR
 * plural-category siblings (see `resolvePluralRaw`) so "1 issue" / "2 issues"
 * pick the grammatically correct form per locale; keys without such siblings
 * fall through to a direct lookup untouched.
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
  const pluralRaw =
    params && typeof params.count === 'number' ? resolvePluralRaw(locale, key, params.count) : null;
  const raw =
    pluralRaw ??
    getPath(dictionaries[locale], key) ??
    getPath(dictionaries[defaultLocale], key) ??
    key;
  let value = typeof raw === 'string' ? raw : key;
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      // `count` is a cardinal number → render it with the locale's digit
      // grouping; every other placeholder is inserted verbatim (years, ids,
      // and pre-escaped HTML fragments must not be reformatted).
      const rendered =
        name === 'count' && typeof replacement === 'number'
          ? numberFormatFor(locale).format(replacement)
          : String(replacement);
      value = value.replaceAll(`{${name}}`, () => rendered);
    }
  }
  return value;
}

/**
 * Pick the best supported locale from an HTTP `Accept-Language` header, honoring
 * `q`-weights and matching on the base language subtag (so `es-MX` → `es`).
 * Returns `null` when nothing matches, letting callers fall back to the default.
 * Used server-side to seed the locale for first-time visitors who have not yet
 * chosen one (i.e. before the `locale` cookie is set).
 */
export function pickLocaleFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) {
    return null;
  }
  const ranked = header
    .split(',')
    .map(part => {
      const [tag, ...attrs] = part.trim().split(';');
      const q = attrs.map(a => a.trim()).find(a => a.startsWith('q='));
      const quality = q ? Number.parseFloat(q.slice(2)) : 1;
      return { quality: Number.isNaN(quality) ? 0 : quality, tag: tag.trim().toLowerCase() };
    })
    // Drop the wildcard, empty tags, and `q=0` — per RFC 7231 a zero quality
    // means the client explicitly rejects that language, so it must never win.
    .filter(entry => entry.tag && entry.tag !== '*' && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) {
      return base;
    }
  }
  return null;
}

/** Maps an app `Locale` to a BCP 47 tag for `Intl`/`toLocaleDateString` calls. */
export const INTL_LOCALES: Record<Locale, string> = {
  en: 'en-US',
  es: 'es-ES',
};
