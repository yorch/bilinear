'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { usePopoverFlip } from '@/hooks/use-popover-flip';
import { useRestoreFocus } from '@/hooks/use-restore-focus';
import { cn } from '@/lib/utils';

interface SelectPopoverProps {
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
  className?: string;
  disabled?: boolean;
  forceOpen?: boolean;
  onClose?: () => void;
  panelClassName?: string;
  panelDataTestId?: string;
  triggerChildren: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SelectPopover({
  align = 'left',
  children,
  className,
  disabled,
  forceOpen,
  onClose,
  panelClassName,
  panelDataTestId,
  triggerChildren,
  triggerClassName,
  triggerTitle,
}: SelectPopoverProps) {
  const { open, setOpen, ref } = usePopover({ closeOnEscape: true, forceOpen, onClose });
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useRestoreFocus(open, triggerRef);
  const openUpward = usePopoverFlip(open, triggerRef);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [setOpen, onClose]);

  // Move focus into the panel on open (useRestoreFocus returns it on close).
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }
  }, [open]);

  // Roving focus across the option buttons consumers render into the panel.
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
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
        aria-haspopup="true"
        className={cn(
          'flex items-center rounded hover:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName,
        )}
        disabled={disabled}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        onKeyDown={e => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        ref={triggerRef}
        title={triggerTitle}
        type="button"
      >
        {triggerChildren}
      </button>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: keydown implements roving focus for the option buttons inside; the buttons themselves are the interactive elements
        <div
          className={cn(
            'absolute z-50 rounded-md border border-border bg-popover shadow-lg',
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
          data-testid={panelDataTestId}
          id={panelId}
          onKeyDown={handlePanelKeyDown}
          ref={panelRef}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
