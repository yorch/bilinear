'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { getPriorityConfig } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './priority-icon';

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
  return (
    <SelectPopover
      className={className}
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="min-w-[160px] py-1"
      panelDataTestId="priority-select-popover"
      triggerChildren={<PriorityIcon priority={value} />}
      triggerClassName="px-1.5 py-1"
      triggerTitle={getPriorityConfig(value).label}
    >
      {close =>
        PRIORITIES.map(p => {
          const config = getPriorityConfig(p);
          return (
            <button
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                p === value && 'font-medium',
              )}
              key={p}
              onClick={e => {
                e.stopPropagation();
                onChange(p);
                close();
              }}
              type="button"
            >
              <PriorityIcon priority={p} />
              <span>{config.label}</span>
            </button>
          );
        })
      }
    </SelectPopover>
  );
}
