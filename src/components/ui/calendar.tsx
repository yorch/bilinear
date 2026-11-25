'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a local calendar day — the value shape every date field in the app uses. */
export function toDateKey(y: number, monthIndex: number, day: number): string {
  return `${y}-${pad(monthIndex + 1)}-${pad(day)}`;
}

/** Parse `YYYY-MM-DD` (a longer ISO string is truncated); null when it is not a real date. */
export function parseDateKey(value: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const check = new Date(y, mo, d);
  return check.getFullYear() === y && check.getMonth() === mo && check.getDate() === d
    ? [y, mo, d]
    : null;
}

/** Whether `key` is outside the inclusive `min`/`max` bounds (both optional `YYYY-MM-DD`). */
export function isDateDisabled(key: string, min?: string, max?: string): boolean {
  return Boolean((min && key < min) || (max && key > max));
}

/**
 * First day of the week for a locale as a JS weekday (0 = Sunday). Falls back to
 * Sunday where `Intl.Locale#getWeekInfo` is unavailable; Monday-first locales
 * (es, most of Europe) report 1.
 */
function firstWeekday(intlLocale: string | undefined): number {
  try {
    const loc = new Intl.Locale(intlLocale ?? 'en-US') as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay;
    return first === undefined ? 0 : first % 7;
  } catch {
    return 0;
  }
}

/**
 * Parse text typed into a date field: `YYYY-MM-DD`, or a locale-ordered date
 * (`25/11/2026`, `11/25/2026`) with a four-digit year. Null when it is not a
 * real calendar day.
 */
export function parseTypedDate(text: string, intlLocale?: string): string | null {
  const trimmed = text.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const parts = parseDateKey(toDateKey(y, m - 1, d));
    return parts && parts[0] === y ? toDateKey(...parts) : null;
  }
  const nums = trimmed.split(/\D+/).filter(Boolean);
  if (
    nums.length !== 3 ||
    !/^\d{1,2}\D+\d{1,2}\D+\d{4}$|^\d{4}\D+\d{1,2}\D+\d{1,2}$/.test(trimmed)
  ) {
    return null;
  }
  const order = new Intl.DateTimeFormat(intlLocale ?? 'en-US')
    .formatToParts(new Date(2000, 10, 25))
    .map(p => p.type)
    .filter(type => type === 'day' || type === 'month' || type === 'year');
  const byType: Record<string, number> = {};
  order.forEach((type, idx) => {
    byType[type] = Number(nums[idx]);
  });
  if (byType.year === undefined || byType.month === undefined || byType.day === undefined) {
    return null;
  }
  const parts = parseDateKey(toDateKey(byType.year, byType.month - 1, byType.day));
  return parts && parts[0] === byType.year ? toDateKey(...parts) : null;
}

const keyOf = (d: Date) => toDateKey(d.getFullYear(), d.getMonth(), d.getDate());

/** Move a `YYYY-MM-DD` key by days, clamping the day-of-month when stepping months. */
function shiftKey(key: string, unit: 'day' | 'month', amount: number): string {
  const [y, m, d] = parseDateKey(key) ?? [2000, 0, 1];
  if (unit === 'day') {
    return keyOf(new Date(y, m, d + amount));
  }
  const first = new Date(y, m + amount, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return keyOf(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}

interface CalendarProps {
  className?: string;
  /** Inclusive latest selectable day, `YYYY-MM-DD`. */
  max?: string;
  /** Inclusive earliest selectable day, `YYYY-MM-DD`. */
  min?: string;
  /** Called with `YYYY-MM-DD`. */
  onChange: (date: string) => void;
  /** Selected day, `YYYY-MM-DD`, or empty. */
  value?: string | null;
}

/**
 * Themed month grid. The shared replacement for `<input type="date">`, whose
 * browser-drawn popup ignores the app's theme and accent. Value in and out is
 * a `YYYY-MM-DD` string, so it is a drop-in for the native input's value.
 */
export function Calendar({ className, max, min, onChange, value }: CalendarProps) {
  const t = useTranslations();
  const { intlLocale } = useFormatters();
  const selected = parseDateKey(value);
  const today = useMemo(() => keyOf(new Date()), []);
  const seed = selected ?? parseDateKey(today) ?? [2000, 0, 1];
  const [view, setView] = useState<[number, number]>([seed[0], seed[1]]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef(false);
  const [year, month] = view;

  const start = firstWeekday(intlLocale);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
    // 2023-01-01 was a Sunday.
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(2023, 0, 1 + ((start + i) % 7))),
    );
  }, [intlLocale, start]);
  const dayLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, {
      day: 'numeric',
      month: 'long',
      weekday: 'long',
      year: 'numeric',
    });
    return (y: number, m: number, d: number) => fmt.format(new Date(y, m, d));
  }, [intlLocale]);
  const monthLabel = new Intl.DateTimeFormat(intlLocale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1));

  const lead = (new Date(year, month, 1).getDay() - start + 7) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setView([d.getFullYear(), d.getMonth()]);
  };
  const selectedKey = selected ? toDateKey(...selected) : null;

  const prevDisabled = Boolean(min && keyOf(new Date(year, month, 0)) < min);
  const nextDisabled = Boolean(max && keyOf(new Date(year, month + 1, 1)) > max);

  // Roving tabindex: exactly one day is in the tab order — the keyboard focus
  // if it is on this month, else the selection, today, or the first enabled day.
  const monthPrefix = `${year}-${pad(month + 1)}-`;
  const rovingKey = useMemo(() => {
    const usable = (k: string | null): k is string =>
      Boolean(k?.startsWith(monthPrefix)) && !isDateDisabled(k as string, min, max);
    const hit = [focusKey, selectedKey, today].find(usable);
    if (hit) {
      return hit;
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const k = toDateKey(year, month, d);
      if (!isDateDisabled(k, min, max)) {
        return k;
      }
    }
    return null;
  }, [focusKey, selectedKey, today, monthPrefix, min, max, year, month, daysInMonth]);

  // Keyboard navigation changes the view and the focus target in one go; the
  // DOM focus follows once the new month has rendered.
  useEffect(() => {
    if (pendingFocus.current) {
      pendingFocus.current = false;
      gridRef.current?.querySelector<HTMLElement>(`[data-date="${rovingKey}"]`)?.focus();
    }
  });

  const onGridKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const from = (e.target as HTMLElement).getAttribute('data-date');
    if (!from) {
      return;
    }
    const dow =
      (new Date(...(parseDateKey(from) as [number, number, number])).getDay() - start + 7) % 7;
    let next: string | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        next = shiftKey(from, 'day', -1);
        break;
      case 'ArrowRight':
        next = shiftKey(from, 'day', 1);
        break;
      case 'ArrowUp':
        next = shiftKey(from, 'day', -7);
        break;
      case 'ArrowDown':
        next = shiftKey(from, 'day', 7);
        break;
      case 'Home':
        next = shiftKey(from, 'day', -dow);
        break;
      case 'End':
        next = shiftKey(from, 'day', 6 - dow);
        break;
      case 'PageUp':
        next = shiftKey(from, 'month', e.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        next = shiftKey(from, 'month', e.shiftKey ? 12 : 1);
        break;
      default:
        return;
    }
    // Claim the key: the enclosing popover would otherwise rove one *button* at a time.
    e.preventDefault();
    e.stopPropagation();
    if (min && next < min) {
      next = min;
    }
    if (max && next > max) {
      next = max;
    }
    const parts = parseDateKey(next);
    if (!parts) {
      return;
    }
    pendingFocus.current = true;
    setFocusKey(next);
    setView([parts[0], parts[1]]);
  };

  return (
    <div className={cn('w-64 p-2 text-sm', className)}>
      <div className="mb-1 flex items-center justify-between">
        <button
          aria-label={t('calendar.previousMonth')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={prevDisabled}
          onClick={() => shift(-1)}
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span aria-live="polite" className="text-xs font-medium text-foreground">
          {monthLabel}
        </span>
        <button
          aria-label={t('calendar.nextMonth')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          disabled={nextDisabled}
          onClick={() => shift(1)}
          type="button"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <table
        aria-label={monthLabel}
        className="w-full table-fixed border-separate border-spacing-0.5 text-center"
        onKeyDown={onGridKeyDown}
        ref={gridRef}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a native table given the ARIA grid pattern so days are announced as selectable grid cells
        role="grid"
      >
        <thead>
          <tr>
            {weekdays.map(w => (
              <th
                className="py-1 text-[11px] font-normal text-muted-foreground"
                key={w}
                scope="col"
              >
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map(week => (
            <tr key={week.find(d => d !== null) ?? 'w'}>
              {week.map((day, i) => {
                if (day === null) {
                  // biome-ignore lint/suspicious/noArrayIndexKey: blank cells have no identity
                  return <td key={`blank-${i}`} />;
                }
                const key = toDateKey(year, month, day);
                const isSelected = key === selectedKey;
                return (
                  // biome-ignore lint/a11y/useFocusableInteractive: the day button inside the cell is the focus target (roving tabindex)
                  <td
                    aria-selected={isSelected}
                    key={key}
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an explicit gridcell is what makes aria-selected valid on the td
                    role="gridcell"
                  >
                    <button
                      aria-current={key === today ? 'date' : undefined}
                      aria-label={dayLabel(year, month, day)}
                      className={cn(
                        'w-full rounded-md py-1 font-mono text-xs tabular-nums hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                        key === today && !isSelected && 'font-semibold text-foreground underline',
                        isSelected &&
                          'border border-brand-border bg-brand-subtle font-semibold text-brand-subtle-foreground',
                      )}
                      data-autofocus={isSelected ? '' : undefined}
                      data-date={key}
                      disabled={isDateDisabled(key, min, max)}
                      onClick={e => {
                        e.stopPropagation();
                        setFocusKey(key);
                        onChange(key);
                      }}
                      tabIndex={key === rovingKey ? 0 : -1}
                      type="button"
                    >
                      {day}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
