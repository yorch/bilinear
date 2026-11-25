'use client';

import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { Calendar, isDateDisabled, parseDateKey, parseTypedDate } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { SelectPopover } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

interface DateFieldProps {
  /** Accessible name; also the placeholder shown while empty. */
  ariaLabel: string;
  className?: string;
  max?: string;
  min?: string;
  /** Called with `YYYY-MM-DD`, or `''` when cleared. */
  onChange: (date: string) => void;
  value: string;
}

/**
 * Form-field date control: an input-styled trigger that opens a themed
 * `Calendar` popover. Replaces `<input type="date">` in toolbars and filters.
 */
export function DateField({ ariaLabel, className, max, min, onChange, value }: DateFieldProps) {
  const t = useTranslations();
  const { formatDate, intlLocale } = useFormatters();
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState<string | null>(null);
  const parts = parseDateKey(value);
  const label = parts
    ? formatDate(new Date(parts[0], parts[1], parts[2]), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;
  return (
    <SelectPopover
      className={className}
      panelClassName="p-0"
      triggerAriaLabel={label ? `${ariaLabel}: ${label}` : ariaLabel}
      triggerChildren={
        <>
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label ?? ariaLabel}</span>
        </>
      }
      triggerClassName={cn(
        'w-full justify-start gap-2 rounded-md border border-input px-3 py-1.5 text-sm',
        label ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {close => (
        <>
          <div className="border-b border-border p-2">
            <Input
              aria-invalid={typedError ? true : undefined}
              aria-label={t('calendar.dateInput')}
              className="px-2 py-1 text-xs"
              data-autofocus
              inputMode="numeric"
              onChange={e => {
                setTyped(e.target.value);
                setTypedError(null);
              }}
              onKeyDown={e => {
                if (e.key !== 'Enter') {
                  return;
                }
                // Enter commits the typed date; it must not submit a surrounding form.
                e.preventDefault();
                e.stopPropagation();
                const key = parseTypedDate(typed, intlLocale);
                if (!key) {
                  setTypedError(t('calendar.invalidDate', { example: 'YYYY-MM-DD' }));
                } else if (isDateDisabled(key, min, max)) {
                  setTypedError(t('calendar.outOfRange'));
                } else {
                  setTyped('');
                  onChange(key);
                  close();
                }
              }}
              placeholder="YYYY-MM-DD"
              value={typed}
            />
            {typedError && (
              <p className="mt-1 text-xs text-danger-subtle-foreground" role="alert">
                {typedError}
              </p>
            )}
          </div>
          <Calendar
            max={max}
            min={min}
            onChange={d => {
              onChange(d);
              close();
            }}
            value={value}
          />
          {value && (
            <button
              className="block w-full border-t border-border px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange('');
                close();
              }}
              type="button"
            >
              {t('calendar.clear')}
            </button>
          )}
        </>
      )}
    </SelectPopover>
  );
}
