'use client';

import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';

export interface SelectOption {
  label: string;
  value: string;
}

interface SimpleSelectProps {
  /**
   * Accessible name for the trigger. Required wherever the visible label is a
   * plain `<span>` rather than a real `<label htmlFor>` — e.g. the custom-field
   * value rows, where the control would otherwise announce as an unnamed button.
   */
  ariaLabel?: string;
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
  ariaLabel,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const current = options.find(o => o.value === value);

  useOutsideClick(ref, () => setOpen(false), open);

  // The trigger advertises `aria-haspopup="listbox"`, so the panel has to be a
  // real listbox: focus moves into it on open, and Up/Down/Home/End rove across
  // the options. Mirrors SelectPopover's handling — without it a screen reader
  // is told "has popup listbox" and then handed a row of plain buttons.
  useEffect(() => {
    if (open) {
      const items = panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
      const selected = panelRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      (selected ?? items?.[0])?.focus();
    }
  }, [open]);

  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown'
        ? (idx + 1) % items.length
        : e.key === 'ArrowUp'
          ? idx <= 0
            ? items.length - 1
            : idx - 1
          : e.key === 'Home'
            ? 0
            : items.length - 1;
    items[next]?.focus();
  }, []);

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
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
          id={panelId}
          onKeyDown={handlePanelKeyDown}
          ref={panelRef}
          role="listbox"
        >
          {placeholder && (
            <p className="flex w-full cursor-default items-center px-3 py-1.5 text-sm text-muted-foreground">
              {placeholder}
            </p>
          )}
          {options.map(opt => (
            <button
              aria-selected={opt.value === value}
              className={cn(
                'flex w-full items-center px-3 py-1.5 text-sm text-foreground hover:bg-accent',
                opt.value === value && 'font-medium',
              )}
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              role="option"
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
