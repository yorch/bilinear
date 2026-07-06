import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate } from './i18n';
import { cn, formatFileSize, formatRelativeTime, getErrorMessage, gqlError } from './utils';

const testTranslate = (key: string, params?: Record<string, string | number>) =>
  translate('en', key, params);

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('lets later tailwind classes win conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});

describe('gqlError', () => {
  it('returns the first error message', () => {
    expect(gqlError({ errors: [{ message: 'boom' }] }, 'fallback')).toBe('boom');
  });

  it('falls back when there are no errors', () => {
    expect(gqlError({}, 'fallback')).toBe('fallback');
    expect(gqlError({ errors: [] }, 'fallback')).toBe('fallback');
  });

  it('falls back when the first error has no message', () => {
    expect(gqlError({ errors: [{}] }, 'fallback')).toBe('fallback');
  });
});

describe('getErrorMessage', () => {
  it('extracts the message from an Error', () => {
    expect(getErrorMessage(new Error('nope'), 'fallback')).toBe('nope');
  });

  it('falls back for non-Error values', () => {
    expect(getErrorMessage('a string', 'fallback')).toBe('fallback');
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('shows "just now" under a minute', () => {
    expect(formatRelativeTime(ago(30 * 1000), testTranslate)).toBe('just now');
  });

  it('shows minutes', () => {
    expect(formatRelativeTime(ago(5 * MIN), testTranslate)).toBe('5m ago');
  });

  it('shows hours', () => {
    expect(formatRelativeTime(ago(3 * HOUR), testTranslate)).toBe('3h ago');
  });

  it('shows "yesterday" at one day', () => {
    expect(formatRelativeTime(ago(DAY), testTranslate)).toBe('yesterday');
  });

  it('shows days then weeks', () => {
    expect(formatRelativeTime(ago(3 * DAY), testTranslate)).toBe('3d ago');
    expect(formatRelativeTime(ago(14 * DAY), testTranslate)).toBe('2w ago');
  });

  it('falls back to an absolute date beyond a month', () => {
    // 45 days before 2026-06-15 → 2026-05-01
    expect(formatRelativeTime(ago(45 * DAY), testTranslate)).toBe('May 1');
  });

  it('translates into Spanish when given a Spanish translator', () => {
    const esTranslate = (key: string, params?: Record<string, string | number>) =>
      translate('es', key, params);
    expect(formatRelativeTime(ago(5 * MIN), esTranslate)).toBe('hace 5m');
    expect(formatRelativeTime(ago(DAY), esTranslate)).toBe('ayer');
  });
});

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('uses KB right at the 1024 boundary', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('uses the locale decimal separator', () => {
    expect(formatFileSize(1536, 'es-ES')).toBe('1,5 KB');
  });
});

describe('translate placeholder interpolation', () => {
  it('substitutes named placeholders', () => {
    expect(translate('en', 'nav.removeNamedFromFavorites', { name: 'Alpha' })).toBe(
      'Remove Alpha from favorites',
    );
  });

  it('treats $-sequences in replacement values literally (no special patterns)', () => {
    // A value containing $&, $', $` or $$ must be inserted verbatim — not
    // interpreted as String.prototype.replaceAll special replacement patterns.
    const tricky = "A$&B$'C$`D$$E";
    expect(translate('en', 'nav.removeNamedFromFavorites', { name: tricky })).toBe(
      `Remove ${tricky} from favorites`,
    );
  });

  it('falls back to English then the raw key on a miss', () => {
    expect(translate('es', 'this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });
});
