'use client';

import { CalendarDays } from 'lucide-react';
import { getDueDatePresets } from '@/components/properties/due-date-presets';
import { PropertyPlaceholder } from '@/components/properties/property-placeholder';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { getDueDateColor } from '@/lib/issue-utils';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface DueDatePickerProps {
  className?: string;
  forceOpen?: boolean;
  /** Empty-state trigger text; defaults to "Due date". The start-date picker overrides it. */
  label?: string;
  onChange: (date: string | null) => void;
  onClose?: () => void;
  /**
   * `neutral` for dates that aren't deadlines (a project's start date): a past
   * start is not overdue, and red must keep meaning failure.
   */
  tone?: 'neutral' | 'urgency';
  value: string | null | undefined;
}

const PRESET_LABEL_KEYS_MAP = {
  endOfWeek: 'properties.dueDate.endOfWeek',
  nextWeek: 'properties.dueDate.nextWeek',
  today: 'properties.dueDate.today',
  tomorrow: 'properties.dueDate.tomorrow',
} as const;

export function DueDatePicker({
  value,
  onChange,
  className,
  forceOpen,
  label,
  onClose,
  tone = 'urgency',
}: DueDatePickerProps) {
  const t = useTranslations();
  const { formatDueDate } = useFormatters();
  const colorClass = tone === 'neutral' ? 'text-foreground-secondary' : getDueDateColor(value);

  return (
    <SelectPopover
      align="right"
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="min-w-[180px] p-1"
      triggerChildren={
        value ? formatDueDate(value) : (label ?? <PropertyPlaceholder icon={CalendarDays} />)
      }
      triggerClassName={cn(
        'px-1.5 py-1 text-xs',
        TOUCH_TARGET,
        'max-md:justify-start',
        value ? colorClass : 'text-muted-foreground',
      )}
      triggerTitle={
        value
          ? t('properties.dueDate.dueOn', { date: formatDueDate(value) })
          : t('properties.dueDate.noDueDate')
      }
    >
      {close => (
        <>
          {getDueDatePresets().map(preset => (
            <button
              className={cn(
                POPOVER_ITEM_CLASS,
                'rounded-md',
                value?.slice(0, 10) === preset.date && 'font-medium',
              )}
              key={preset.key}
              onClick={e => {
                e.stopPropagation();
                onChange(preset.date);
                close();
              }}
              type="button"
            >
              <span className="flex-1 text-left">{t(PRESET_LABEL_KEYS_MAP[preset.key])}</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDueDate(`${preset.date}T00:00:00`)}
              </span>
            </button>
          ))}
          <p className="mt-1 border-t border-border px-3 pt-2 pb-1 text-xs text-muted-foreground">
            {t('properties.dueDate.orPickDate')}
          </p>
          {/* Claims initial focus: the "Clear date" button below sits after this
              field in document order, so without the marker opening the picker
              focuses Clear and the first Enter wipes the date. */}
          <input
            className="mx-2 mb-1 rounded border border-input bg-transparent px-2 py-1 text-sm"
            data-autofocus
            onChange={e => {
              onChange(e.target.value || null);
              close();
            }}
            type="date"
            value={value ?? ''}
          />
          {value && (
            <button
              className="mt-1 block w-full rounded px-2 py-1 text-center text-xs text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange(null);
                close();
              }}
              type="button"
            >
              {t('properties.dueDate.clearDate')}
            </button>
          )}
        </>
      )}
    </SelectPopover>
  );
}
