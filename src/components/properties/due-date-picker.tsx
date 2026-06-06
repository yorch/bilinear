'use client';

import { usePopover } from '@/hooks/use-popover';
import { formatDueDate, getDueDateColor } from '@/lib/issue-utils';
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
  const { open, setOpen, ref } = usePopover({ forceOpen, onClose });

  const colorClass = getDueDateColor(value);

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className={cn(
          'flex items-center rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800',
          value ? colorClass : 'text-zinc-400',
        )}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={value ? `Due ${formatDueDate(value)}` : 'No due date'}
        type="button"
      >
        {value ? formatDueDate(value) : 'Due date'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input
            className="rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            onChange={e => {
              onChange(e.target.value || null);
              setOpen(false);
              onClose?.();
            }}
            type="date"
            value={value ?? ''}
          />
          {value && (
            <button
              className="mt-1 block w-full rounded px-2 py-1 text-center text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              onClick={() => {
                onChange(null);
                setOpen(false);
                onClose?.();
              }}
              type="button"
            >
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
