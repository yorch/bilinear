'use client';

import { CalendarDays } from 'lucide-react';
import { Calendar, parseDateKey } from '@/components/ui/calendar';
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
  const { formatDate } = useFormatters();
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
