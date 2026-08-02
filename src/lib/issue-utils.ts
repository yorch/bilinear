import type { Locale as DateFnsLocale } from 'date-fns';
import { differenceInCalendarDays, format, isToday } from 'date-fns';

export const PRIORITY_CONFIG = {
  0: { color: 'var(--priority-none)', icon: '-', label: 'No priority' },
  1: { color: 'var(--priority-urgent)', icon: '!!!', label: 'Urgent' },
  2: { color: 'var(--priority-high)', icon: '!!', label: 'High' },
  3: { color: 'var(--priority-medium)', icon: '!', label: 'Medium' },
  4: { color: 'var(--priority-low)', icon: '·', label: 'Low' },
} as const;

export type Priority = keyof typeof PRIORITY_CONFIG;

/** Flat label lookup keyed by priority integer (0–4). */
export const PRIORITY_LABELS: Record<number, string> = Object.fromEntries(
  Object.entries(PRIORITY_CONFIG).map(([k, v]) => [Number(k), v.label]),
);

/** Select-compatible options for filter and picker UIs. */
export const PRIORITY_OPTIONS: { label: string; value: string }[] = [0, 1, 2, 3, 4].map(p => ({
  label: PRIORITY_CONFIG[p as Priority].label,
  value: String(p),
}));

/** Emoji palette shared by comment and issue reaction pickers. */
export const QUICK_EMOJIS = ['👍', '👎', '❤️', '🎉', '😄', '🚀', '👀', '😕'] as const;

export function getPriorityConfig(priority: number) {
  return PRIORITY_CONFIG[priority as Priority] ?? PRIORITY_CONFIG[0];
}

/** Returns a CSS color class for the due date indicator. */
export function getDueDateColor(dueDate: string | null | undefined): string {
  if (!dueDate) {
    return 'text-muted-foreground';
  }

  const date = new Date(dueDate);
  const daysUntil = differenceInCalendarDays(date, new Date());

  // Four distinct urgency levels. The status-token migration briefly collapsed
  // "due today" and "due within 3 days" onto one class (orange and yellow both
  // map to the warning role), which silently erased a level — they use the
  // high-contrast and the vivid warning token respectively to stay apart.
  if (daysUntil < 0) {
    return 'text-danger-subtle-foreground';
  }
  if (isToday(date)) {
    return 'text-warning-subtle-foreground';
  }
  if (daysUntil <= 3) {
    return 'text-warning';
  }
  return 'text-muted-foreground';
}

export function formatDueDate(
  dueDate: string | null | undefined,
  dateFnsLocale?: DateFnsLocale,
): string {
  if (!dueDate) {
    return '';
  }
  return format(new Date(dueDate), 'MMM d', dateFnsLocale ? { locale: dateFnsLocale } : undefined);
}

/**
 * Derives a git-friendly branch name from an issue, e.g. `eng-123-fix-login-bug`.
 * Mirrors Linear's "Copy git branch name" — purely a client-side slug, not
 * backed by the (currently unused) `branchName` DB column.
 */
export function getBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return slug ? `${identifier.toLowerCase()}-${slug}` : identifier.toLowerCase();
}
