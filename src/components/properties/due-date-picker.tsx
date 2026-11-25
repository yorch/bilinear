'use client';

import { CalendarClock, CalendarDays } from 'lucide-react';
import { getDueDatePresets } from '@/components/properties/due-date-presets';
import { PropertyPlaceholder } from '@/components/properties/property-placeholder';
import { DatePanel } from '@/components/ui/date-field';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { getDueDateColor } from '@/lib/issue-utils';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface DueDatePickerProps {
  className?: string;
  forceOpen?: boolean;
  /**
   * Prefix a set value with its icon below `lg`, where the detail view hides the
   * property labels and a bare "Nov 16" would be unlabelled.
   */
  iconBelowLg?: boolean;
  /**
   * Which date this picks. `start` gets its own icon, title and accessible
   * name so it is never confused with the due-date chip beside it.
   * @default 'due'
   */
  kind?: 'due' | 'start';
  /** Empty-state trigger text; defaults to "Due date". The start-date picker overrides it. */
  label?: string;
  /**
   * Short field name shown below `lg` — before a set date, and beside the icon
   * while empty — where the detail view hides the property labels. Hidden from
   * `lg` up. Supersedes `iconBelowLg` for the set state.
   */
  labelBelowLg?: string;
  /** Inclusive latest selectable day, `YYYY-MM-DD`. */
  max?: string;
  /** Inclusive earliest selectable day, `YYYY-MM-DD`. */
  min?: string;
  onChange: (date: string | null) => void;
  onClose?: () => void;
  /** Workflow state type of the owning issue; done/canceled work is never shown as overdue. */
  stateType?: string | null;
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
  iconBelowLg,
  kind = 'due',
  label,
  labelBelowLg,
  max,
  min,
  onClose,
  stateType,
  tone = 'urgency',
}: DueDatePickerProps) {
  const t = useTranslations();
  const { formatDueDate } = useFormatters();
  const colorClass =
    tone === 'neutral' ? 'text-foreground-secondary' : getDueDateColor(value, stateType);

  const isStart = kind === 'start';
  const title = value
    ? t(isStart ? 'properties.startDate.startsOn' : 'properties.dueDate.dueOn', {
        date: formatDueDate(value),
      })
    : t(isStart ? 'properties.startDate.noStartDate' : 'properties.dueDate.noDueDate');

  return (
    <SelectPopover
      align="right"
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="min-w-[180px] p-1"
      triggerAriaLabel={title}
      triggerChildren={
        value ? (
          <>
            {labelBelowLg && (
              <span className="text-muted-foreground lg:hidden">{labelBelowLg}</span>
            )}
            {iconBelowLg &&
              !labelBelowLg &&
              (isStart ? (
                <CalendarClock aria-hidden="true" className="h-3 w-3 shrink-0 lg:hidden" />
              ) : (
                <CalendarDays aria-hidden="true" className="h-3 w-3 shrink-0 lg:hidden" />
              ))}
            {formatDueDate(value)}
          </>
        ) : (
          (label ?? (
            <PropertyPlaceholder
              icon={isStart ? CalendarClock : CalendarDays}
              label={labelBelowLg}
              labelBelowLg
            />
          ))
        )
      }
      triggerClassName={cn(
        'px-1.5 py-1 text-xs',
        TOUCH_TARGET,
        'max-md:justify-start',
        value ? colorClass : 'text-muted-foreground',
      )}
      triggerTitle={title}
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
          {/* A set date focuses its own day in the grid (the Calendar marks it
              `data-autofocus`), so the first Enter re-picks it rather than
              wiping it; with no date the typed-entry field takes focus. The
              clear action sits last, after both, so it can never claim focus. */}
          <DatePanel
            autoFocusInput={!value}
            clearLabel={t('properties.dueDate.clearDate')}
            max={max}
            min={min}
            onChange={d => onChange(d || null)}
            onClose={close}
            value={value ?? ''}
          />
        </>
      )}
    </SelectPopover>
  );
}
