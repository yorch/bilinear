import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Below `md`, grow a control to the 44px minimum touch target (WCAG 2.5.8).
 * `min-w` rather than `w`, so a trigger whose label is wider than its icon —
 * the reaction bar's "🙂 React", the editor toolbar's `B`/`I`/`U` glyphs —
 * still fits. This is the default; reach for `TOUCH_TARGET_SQUARE` only when
 * the content is a fixed-size icon and a square hit area is the intent.
 *
 * A string, not a `Button` variant: most of these are raw `<button>`/`<Link>`
 * elements, and `SelectPopover` renders its own trigger and accepts only a
 * `triggerClassName`.
 */
export const TOUCH_TARGET =
  'max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center';

/** Fixed 44×44 variant, for controls wrapping a fixed-size icon. */
export const TOUCH_TARGET_SQUARE = 'max-md:h-11 max-md:w-11';

/** Extract the first error message from a GraphQL response, with a fallback. */
export function gqlError(result: { errors?: unknown[] }, fallback: string): string {
  return (result.errors?.[0] as { message?: string })?.message ?? fallback;
}

/** Extract a human-readable message from an unknown catch value, with a fallback. */
export function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Format a timestamp as a human-readable relative time string (e.g. "5m ago"). */
export function formatRelativeTime(dateStr: string, t: Translate, intlLocale = 'en-US'): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));

  if (diffMins < 1) {
    return t('common.relativeTime.justNow');
  }
  if (diffMins < 60) {
    return t('common.relativeTime.minutesAgo', { count: diffMins });
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return t('common.relativeTime.hoursAgo', { count: diffHours });
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return t('common.relativeTime.yesterday');
  }
  if (diffDays < 7) {
    return t('common.relativeTime.daysAgo', { count: diffDays });
  }
  if (diffDays < 30) {
    return t('common.relativeTime.weeksAgo', { count: Math.floor(diffDays / 7) });
  }
  return date.toLocaleDateString(intlLocale, { day: 'numeric', month: 'short' });
}

const fileSizeFormatters = new Map<string, Intl.NumberFormat>();

function getFileSizeFormatter(intlLocale: string): Intl.NumberFormat {
  let formatter = fileSizeFormatters.get(intlLocale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(intlLocale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    });
    fileSizeFormatters.set(intlLocale, formatter);
  }
  return formatter;
}

/** Format a byte count as a human-readable, locale-aware file size string. */
export function formatFileSize(bytes: number, intlLocale = 'en-US'): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const formatter = getFileSizeFormatter(intlLocale);
  if (bytes < 1024 * 1024) {
    return `${formatter.format(bytes / 1024)} KB`;
  }
  return `${formatter.format(bytes / (1024 * 1024))} MB`;
}
