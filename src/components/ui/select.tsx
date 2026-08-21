'use client';

import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { usePopoverPanel } from '@/hooks/use-popover-panel';
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
  /**
   * Renders the trigger read-only. Used where a value exists but nothing may
   * change it — an `override`-mode environment variable supplying a config
   * knob, for instance, where accepting a change would appear to succeed and
   * silently do nothing.
   */
  disabled?: boolean;
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
  disabled = false,
  id,
  variant = 'default',
  placement = 'bottom',
}: SimpleSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value);

  // The panel is a strict listbox, so roving covers its options only. The hook
  // also returns focus to the trigger on close; paired with `closeOnEscape`
  // below that is what keeps an open panel from being a keyboard trap, since
  // focus is moved *into* it on open.
  const {
    onKeyDown: handlePanelKeyDown,
    panelId,
    panelRef,
    triggerRef,
  } = usePopoverPanel({ itemSelector: '[role="option"]' }, open);
  useOutsideClick(ref, () => setOpen(false), open, true);

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={cn(
          'flex items-center gap-1.5 text-sm outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input',
          variant === 'default' &&
            'w-full justify-between rounded-md border border-input bg-transparent px-3 py-1.5 text-foreground hover:border-ring',
          variant === 'ghost' &&
            'rounded px-1.5 py-0.5 font-medium text-foreground hover:bg-accent',
        )}
        disabled={disabled}
        id={id}
        onClick={() => setOpen(o => !o)}
        ref={triggerRef}
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
          {/* Outside the listbox deliberately: it is a caption, not a choice, and
              a listbox whose children are not all options is invalid ARIA. */}
          {placeholder && (
            <p className="flex w-full cursor-default items-center px-3 py-1.5 text-sm text-muted-foreground">
              {placeholder}
            </p>
          )}
          <div id={panelId} onKeyDown={handlePanelKeyDown} ref={panelRef} role="listbox">
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
        </div>
      )}
    </div>
  );
}
