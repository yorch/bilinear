'use client';

import { useEffect, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';

interface WorkflowState {
  color: string;
  id: string;
  name: string;
  type: string;
}

interface StatusSelectProps {
  className?: string;
  forceOpen?: boolean;
  onChange: (stateId: string) => void;
  onClose?: () => void;
  states: WorkflowState[];
  value: string;
}

export function StatusDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 rounded-full flex-shrink-0', className)}
      style={{ backgroundColor: color }}
    />
  );
}

export function StatusSelect({
  value,
  states,
  onChange,
  className,
  forceOpen,
  onClose,
}: StatusSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = states.find(s => s.id === value);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  useOutsideClick(
    ref,
    () => {
      setOpen(false);
      onClose?.();
    },
    open,
  );

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={current?.name ?? 'Status'}
        type="button"
      >
        {current && <StatusDot color={current.color} />}
        <span className="text-zinc-600 dark:text-zinc-400">{current?.name ?? '—'}</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          data-testid="status-select-popover"
        >
          {states.map(state => (
            <button
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                state.id === value && 'font-medium',
              )}
              key={state.id}
              onClick={e => {
                e.stopPropagation();
                onChange(state.id);
                setOpen(false);
                onClose?.();
              }}
              type="button"
            >
              <StatusDot color={state.color} />
              {state.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
