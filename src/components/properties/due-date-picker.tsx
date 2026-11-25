'use client';

import { CalendarClock, CalendarDays } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { getDueDatePresets } from '@/components/properties/due-date-presets';
import { PropertyPlaceholder } from '@/components/properties/property-placeholder';
import { DatePanel } from '@/components/ui/date-field';
import { MOBILE_SHEET } from '@/components/ui/mobile-sheet';
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

/** Calendar `w-64` (256px) plus the panel's padding and border. */
const PANEL_WIDTH_PX = 268;
const VIEWPORT_MARGIN_PX = 8;

/**
 * Which edge the desktop panel hangs from. It is right-anchored by default, but
 * a trigger near the left edge (the detail page's first chip) would push a
 * 268px panel off-screen, so flip to left-anchored when it would not fit.
 */
function usePanelAlign(forceOpen: boolean | undefined) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [align, setAlign] = useState<'left' | 'right'>('right');
  const measure = () => {
    const trigger = anchorRef.current?.firstElementChild;
    if (!trigger) {
      return;
    }
    const { left, right } = trigger.getBoundingClientRect();
    const fitsRight = right - PANEL_WIDTH_PX >= VIEWPORT_MARGIN_PX;
    const fitsLeft = left + PANEL_WIDTH_PX <= window.innerWidth - VIEWPORT_MARGIN_PX;
    setAlign(fitsRight || !fitsLeft ? 'right' : 'left');
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure is a closure over refs/setters only
  useLayoutEffect(() => {
    if (forceOpen) {
      measure();
    }
  }, [forceOpen]);
  return { align, anchorRef, measure };
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

  const { align, anchorRef, measure } = usePanelAlign(forceOpen);
  const isStart = kind === 'start';
  const title = value
    ? t(isStart ? 'properties.startDate.startsOn' : 'properties.dueDate.dueOn', {
        date: formatDueDate(value),
      })
    : t(isStart ? 'properties.startDate.noStartDate' : 'properties.dueDate.noDueDate');
  // WCAG 2.5.3: the accessible name must contain the visible text. Below `lg`
  // a set chip shows "<field> <date>", so name it from exactly those words.
  const ariaLabel = value && labelBelowLg ? `${labelBelowLg} ${formatDueDate(value)}` : title;

  // Re-picking the date already set is a no-op: committing it would fire a
  // mutation and a SyncAction that change nothing.
  const commit = (next: string | null) => {
    if (next && next === value?.slice(0, 10)) {
      return;
    }
    onChange(next);
  };

  return (
    // The wrapper only exists to measure the trigger before the panel opens;
    // `contents` keeps it out of the surrounding flex/grid layout.
    <div
      className="contents"
      onFocusCapture={measure}
      onPointerDownCapture={measure}
      ref={anchorRef}
    >
      <SelectPopover
        align={align}
        className={className}
        forceOpen={forceOpen}
        onClose={onClose}
        panelClassName={cn(
          'min-w-[180px] p-1 md:max-h-[calc(100dvh-2rem)] md:max-w-[calc(100vw-1rem)] md:overflow-y-auto',
          MOBILE_SHEET,
        )}
        triggerAriaLabel={ariaLabel}
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
          // Below `lg` a set chip is "<field> <date>": two flex items, so the
          // space between them has to be a gap, not a text node.
          value && labelBelowLg && 'gap-1.5',
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
                  'rounded-md disabled:cursor-not-allowed disabled:opacity-50',
                  value?.slice(0, 10) === preset.date && 'font-medium',
                )}
                disabled={(min && preset.date < min) || (max && preset.date > max) || undefined}
                key={preset.key}
                onClick={e => {
                  e.stopPropagation();
                  commit(preset.date);
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
              onChange={d => commit(d || null)}
              onClose={close}
              value={value ?? ''}
            />
          </>
        )}
      </SelectPopover>
    </div>
  );
}
