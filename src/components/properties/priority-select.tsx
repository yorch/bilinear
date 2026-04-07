'use client';

import { useEffect, useRef, useState } from 'react';
import { getPriorityConfig } from '@/lib/issue-utils';
import { cn } from '@/lib/utils';
import { PriorityIcon } from './priority-icon';

interface PrioritySelectProps {
  value: number;
  onChange: (priority: number) => void;
  className?: string;
}

const PRIORITIES = [0, 1, 2, 3, 4] as const;

export function PrioritySelect({
  value,
  onChange,
  className,
}: PrioritySelectProps) {
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

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className="flex items-center rounded px-1.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={getPriorityConfig(value).label}
      >
        <PriorityIcon priority={value} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {PRIORITIES.map(p => {
            const config = getPriorityConfig(p);
            return (
              <button
                key={p}
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  onChange(p);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                  p === value && 'font-medium',
                )}
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
