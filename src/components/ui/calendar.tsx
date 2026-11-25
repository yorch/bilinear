'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
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
  const today = useMemo(() => {
    const n = new Date();
    return toDateKey(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);
  const seed = selected ?? parseDateKey(today) ?? [2000, 0, 1];
  const [view, setView] = useState<[number, number]>([seed[0], seed[1]]);
  const [year, month] = view;

  const start = firstWeekday(intlLocale);
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: 'short' });
    // 2023-01-01 was a Sunday.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + ((start + i) % 7))));
  }, [intlLocale, start]);
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
  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setView([d.getFullYear(), d.getMonth()]);
  };
  const selectedKey = selected ? toDateKey(...selected) : null;

  return (
    <div className={cn('w-64 p-2 text-sm', className)}>
      <div className="mb-1 flex items-center justify-between">
        <button
          aria-label={t('calendar.previousMonth')}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
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
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => shift(1)}
          type="button"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map(w => (
          <span className="py-1 text-[11px] text-muted-foreground" key={w}>
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day === null) {
            // biome-ignore lint/suspicious/noArrayIndexKey: blank leading cells have no identity
            return <span key={`blank-${i}`} />;
          }
          const key = toDateKey(year, month, day);
          const isSelected = key === selectedKey;
          return (
            <button
              aria-pressed={isSelected}
              className={cn(
                'rounded-md py-1 font-mono text-xs tabular-nums hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                key === today && !isSelected && 'font-semibold text-foreground underline',
                isSelected &&
                  'border border-brand-border bg-brand-subtle font-semibold text-brand-subtle-foreground',
              )}
              disabled={isDateDisabled(key, min, max)}
              key={key}
              onClick={e => {
                e.stopPropagation();
                onChange(key);
              }}
              type="button"
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
