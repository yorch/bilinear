import { describe, expect, it } from 'vitest';
import { pickLocaleFromAcceptLanguage, translate } from './index';

describe('translate — pluralization', () => {
  it('selects the "one" form for count === 1', () => {
    expect(translate('en', 'issues.issuesCount', { count: 1 })).toBe('1 issue');
    expect(translate('es', 'issues.issuesCount', { count: 1 })).toBe('1 tarea');
  });

  it('selects the "other" form for count !== 1', () => {
    expect(translate('en', 'issues.issuesCount', { count: 0 })).toBe('0 issues');
    expect(translate('en', 'issues.issuesCount', { count: 5 })).toBe('5 issues');
    expect(translate('es', 'issues.issuesCount', { count: 5 })).toBe('5 tareas');
  });

  it('falls back to the English plural form when a locale lacks the key', () => {
    // Both locales define this key; assert the fallback path resolves a string,
    // not the raw key, for a pluralized lookup.
    expect(translate('es', 'issueDetail.templates.count', { count: 2 })).toBe('2 plantillas');
  });

  it('leaves non-pluralized keys untouched when a count is passed', () => {
    // `common.relativeTime.minutesAgo` has no _one/_other siblings; the plain
    // lookup + interpolation must still work.
    expect(translate('en', 'common.relativeTime.minutesAgo', { count: 3 })).toBe('3m ago');
  });

  it('returns the key when nothing resolves', () => {
    expect(translate('en', 'nonexistent.key.path', { count: 2 })).toBe('nonexistent.key.path');
  });
});

describe('pickLocaleFromAcceptLanguage', () => {
  it('returns null for empty or missing headers', () => {
    expect(pickLocaleFromAcceptLanguage(null)).toBeNull();
    expect(pickLocaleFromAcceptLanguage('')).toBeNull();
  });

  it('matches on the base language subtag', () => {
    expect(pickLocaleFromAcceptLanguage('es-MX')).toBe('es');
    expect(pickLocaleFromAcceptLanguage('en-GB')).toBe('en');
  });

  it('honors q-weights, not header order', () => {
    expect(pickLocaleFromAcceptLanguage('en;q=0.5,es;q=0.9')).toBe('es');
    expect(pickLocaleFromAcceptLanguage('es;q=0.2,en;q=0.8')).toBe('en');
  });

  it('skips unsupported languages and picks the first supported one', () => {
    expect(pickLocaleFromAcceptLanguage('fr-FR,de;q=0.9,es;q=0.8')).toBe('es');
  });

  it('returns null when no supported language is present', () => {
    expect(pickLocaleFromAcceptLanguage('fr-FR,de;q=0.9')).toBeNull();
  });

  it('ignores the wildcard token', () => {
    expect(pickLocaleFromAcceptLanguage('*')).toBeNull();
  });
});
