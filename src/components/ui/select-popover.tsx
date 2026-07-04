'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { cn } from '@/lib/utils';

interface SelectPopoverProps {
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
  className?: string;
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
  const wasOpen = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [setOpen, onClose]);

  // Move focus into the panel on open; return it to the trigger on close —
  // but only when focus actually died with the panel (unmount drops it on
  // <body>), so outside clicks don't have their focus stolen.
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      if (document.activeElement === document.body) {
        triggerRef.current?.focus();
      }
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
          'flex items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800',
          triggerClassName,
        )}
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
            'absolute top-full z-50 mt-1 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900',
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
