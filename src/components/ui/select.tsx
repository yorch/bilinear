'use client';

import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';

export interface SelectOption {
  label: string;
  value: string;
}

interface SimpleSelectProps {
  className?: string;
  id?: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  placement?: 'bottom' | 'top';
  value: string;
  variant?: 'default' | 'ghost';
}

export function SimpleSelect({
  options,
  value,
  onChange,
  placeholder,
  className,
  id,
  variant = 'default',
  placement = 'bottom',
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value);

  useOutsideClick(ref, () => setOpen(false), open);

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className={cn(
          'flex items-center gap-1.5 text-sm outline-none',
          variant === 'default' &&
            'w-full justify-between rounded-md border border-input bg-transparent px-3 py-1.5 text-foreground hover:border-ring',
          variant === 'ghost' &&
            'rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent',
        )}
        id={id}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <span>{current?.label ?? placeholder ?? '—'}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 z-50 min-w-full rounded-md border border-border bg-popover py-1 shadow-e2',
            placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1',
          )}
        >
          {placeholder && (
            <button
              className="flex w-full cursor-default items-center px-3 py-1.5 text-sm text-muted-foreground"
              disabled
              type="button"
            >
              {placeholder}
            </button>
          )}
          {options.map(opt => (
            <button
              className={cn(
                'flex w-full items-center px-3 py-1.5 text-sm text-foreground hover:bg-accent',
                opt.value === value && 'font-medium',
              )}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              type="button"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
