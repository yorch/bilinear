import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

/** Format a byte count as a human-readable file size string. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
