'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className="flex items-center rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={getPriorityConfig(value).label}
        type="button"
      >
        <PriorityIcon priority={value} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          data-testid="priority-select-popover"
        >
          {PRIORITIES.map(p => {
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
                  setOpen(false);
                  onClose?.();
                }}
                type="button"
              >
                <PriorityIcon priority={p} />
                <span>{config.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
