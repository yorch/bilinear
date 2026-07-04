'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { DATE_FNS_LOCALES } from '@/lib/date-fns-locale';
import { formatDueDate, getDueDateColor } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import { useLocale } from '@/providers/locale-provider';

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
  const { locale } = useLocale();
  const colorClass = getDueDateColor(value);
  const dateFnsLocale = DATE_FNS_LOCALES[locale];

  return (
    <SelectPopover
      align="right"
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="p-2"
      triggerChildren={
        value ? formatDueDate(value, dateFnsLocale) : t('properties.dueDate.dueDate')
      }
      triggerClassName={cn('px-1.5 py-1 text-xs', value ? colorClass : 'text-zinc-400')}
      triggerTitle={
        value
          ? t('properties.dueDate.dueOn', { date: formatDueDate(value, dateFnsLocale) })
          : t('properties.dueDate.noDueDate')
      }
    >
      {close => (
        <>
          <input
            className="rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            onChange={e => {
              onChange(e.target.value || null);
              close();
            }}
            type="date"
            value={value ?? ''}
          />
          {value && (
            <button
              className="mt-1 block w-full rounded px-2 py-1 text-center text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
