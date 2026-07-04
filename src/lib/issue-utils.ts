import type { Locale as DateFnsLocale } from 'date-fns';
import { differenceInCalendarDays, format, isToday } from 'date-fns';

export const PRIORITY_CONFIG = {
  0: { color: '#8b8c91', icon: '-', label: 'No priority' },
  1: { color: '#ef4444', icon: '!!!', label: 'Urgent' },
  2: { color: '#f97316', icon: '!!', label: 'High' },
  3: { color: '#eab308', icon: '!', label: 'Medium' },
  4: { color: '#6b7280', icon: '·', label: 'Low' },
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
    return 'text-zinc-500';
  }

  const date = new Date(dueDate);
  const daysUntil = differenceInCalendarDays(date, new Date());

  if (daysUntil < 0) {
    return 'text-red-500';
  }
  if (isToday(date)) {
    return 'text-orange-500';
  }
  if (daysUntil <= 3) {
    return 'text-yellow-500';
  }
  return 'text-zinc-500';
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
