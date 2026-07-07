'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { getDueDateColor } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';

interface DueDatePickerProps {
  className?: string;
  forceOpen?: boolean;
  onChange: (date: string | null) => void;
  onClose?: () => void;
  value: string | null | undefined;
}

export function DueDatePicker({
  value,
  onChange,
  className,
  forceOpen,
  onClose,
}: DueDatePickerProps) {
  const t = useTranslations();
  const { formatDueDate } = useFormatters();
  const colorClass = getDueDateColor(value);

  return (
    <SelectPopover
      align="right"
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="p-2"
      triggerChildren={value ? formatDueDate(value) : t('properties.dueDate.dueDate')}
      triggerClassName={cn('px-1.5 py-1 text-xs', value ? colorClass : 'text-muted-foreground')}
      triggerTitle={
        value
          ? t('properties.dueDate.dueOn', { date: formatDueDate(value) })
          : t('properties.dueDate.noDueDate')
      }
    >
      {close => (
        <>
          <input
            className="rounded border border-border px-2 py-1 text-sm dark:bg-zinc-800"
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
