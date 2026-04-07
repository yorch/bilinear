'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDueDate, getDueDateColor } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';

interface DueDatePickerProps {
  value: string | null | undefined;
  onChange: (date: string | null) => void;
  className?: string;
}

export function DueDatePicker({
  value,
  onChange,
  className,
}: DueDatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const colorClass = getDueDateColor(value);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className={cn(
          'flex items-center rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800',
          value ? colorClass : 'text-zinc-400',
        )}
        title={value ? `Due ${formatDueDate(value)}` : 'No due date'}
      >
        {value ? formatDueDate(value) : 'Due date'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <input
            type="date"
            className="rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            value={value ?? ''}
            onChange={e => {
              onChange(e.target.value || null);
              setOpen(false);
            }}
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="mt-1 block w-full rounded px-2 py-1 text-center text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              Clear date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
