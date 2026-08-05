'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { PriorityIcon, priorityLabelKey } from './priority-icon';

interface PrioritySelectProps {
  className?: string;
  forceOpen?: boolean;
  onChange: (priority: number) => void;
  onClose?: () => void;
  value: number;
}

const PRIORITIES = [0, 1, 2, 3, 4] as const;

export function PrioritySelect({
  value,
  onChange,
  className,
  forceOpen,
  onClose,
}: PrioritySelectProps) {
  const t = useTranslations();
  return (
    <SelectPopover
      className={className}
      forceOpen={forceOpen}
      listbox
      onClose={onClose}
      panelClassName="min-w-[160px] py-1"
      panelDataTestId="priority-select-popover"
      triggerChildren={<PriorityIcon priority={value} />}
      triggerClassName={cn('px-1.5 py-1', TOUCH_TARGET)}
      triggerTitle={t(priorityLabelKey(value))}
    >
      {close =>
        PRIORITIES.map(p => {
          const label = t(priorityLabelKey(p));
          return (
            <button
              aria-selected={p === value}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                p === value && 'font-medium',
              )}
              key={p}
              onClick={e => {
                e.stopPropagation();
                onChange(p);
                close();
              }}
              role="option"
              type="button"
            >
              <PriorityIcon priority={p} />
              <span>{label}</span>
            </button>
          );
        })
      }
    </SelectPopover>
  );
}
