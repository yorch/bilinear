'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface WorkflowState {
  id: string;
  name: string;
  color: string;
  type: string;
}

interface StatusSelectProps {
  value: string;
  states: WorkflowState[];
  onChange: (stateId: string) => void;
  className?: string;
  forceOpen?: boolean;
  onClose?: () => void;
}

export function StatusDot({
  color,
  className,
}: {
  color: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block h-2.5 w-2.5 rounded-full flex-shrink-0',
        className,
      )}
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
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={current?.name ?? 'Status'}
      >
        {current && <StatusDot color={current.color} />}
        <span className="text-zinc-600 dark:text-zinc-400">
          {current?.name ?? '—'}
        </span>
      </button>

      {open && (
        <div
          data-testid="status-select-popover"
          className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {states.map(state => (
            <button
              key={state.id}
              type="button"
              onClick={e => {
                e.stopPropagation();
                onChange(state.id);
                setOpen(false);
                onClose?.();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                state.id === value && 'font-medium',
              )}
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
