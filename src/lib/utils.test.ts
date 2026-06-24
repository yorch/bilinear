import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cn, formatFileSize, formatRelativeTime, getErrorMessage, gqlError } from './utils';

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
    expect(formatRelativeTime(ago(30 * 1000))).toBe('just now');
  });

  it('shows minutes', () => {
    expect(formatRelativeTime(ago(5 * MIN))).toBe('5m ago');
  });

  it('shows hours', () => {
    expect(formatRelativeTime(ago(3 * HOUR))).toBe('3h ago');
  });

  it('shows "yesterday" at one day', () => {
    expect(formatRelativeTime(ago(DAY))).toBe('yesterday');
  });

  it('shows days then weeks', () => {
    expect(formatRelativeTime(ago(3 * DAY))).toBe('3d ago');
    expect(formatRelativeTime(ago(14 * DAY))).toBe('2w ago');
  });

  it('falls back to an absolute date beyond a month', () => {
    // 45 days before 2026-06-15 → 2026-05-01
    expect(formatRelativeTime(ago(45 * DAY))).toBe('May 1');
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
});
