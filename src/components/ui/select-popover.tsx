'use client';

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { usePopoverFlip } from '@/hooks/use-popover-flip';
import { usePopoverPanel } from '@/hooks/use-popover-panel';
import { cn } from '@/lib/utils';

interface SelectPopoverProps {
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
  className?: string;
  disabled?: boolean;
  forceOpen?: boolean;
  /**
   * Opt in to `role="listbox"` on the panel. Only pass this when the panel's
   * children are ALL `role="option"` elements (the ARIA listbox pattern
   * requires option/group children) — e.g. the single-select property pickers.
   * Consumers rendering a calendar, form fields, or an empty-state paragraph
   * (filter-builder, due-date-picker, label-select) must NOT set it.
   */
  listbox?: boolean;
  onClose?: () => void;
  panelClassName?: string;
  panelDataTestId?: string;
  triggerChildren: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}

/**
 * Shared class string for a single option/menu row rendered into a
 * `SelectPopover` panel (and the hand-rolled issue context menu, which mirrors
 * the same visual contract). It lived verbatim at 14 call sites across the
 * property pickers, the bulk-action bar and the context menu; the panel's
 * roving-focus keyboard handling assumes every row looks and sizes alike, so
 * they have to change together.
 *
 * Compose per-row state on top with `cn(POPOVER_ITEM_CLASS, selected && '…')`.
 */
export const POPOVER_ITEM_CLASS =
  'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent';

export function SelectPopover({
  align = 'left',
  children,
  className,
  disabled,
  forceOpen,
  listbox,
  onClose,
  panelClassName,
  panelDataTestId,
  triggerChildren,
  triggerClassName,
  triggerTitle,
}: SelectPopoverProps) {
  const { open, setOpen, ref } = usePopover({ closeOnEscape: true, forceOpen, onClose });
  // Panels here hold arbitrary consumer markup, so roving covers every enabled
  // button rather than just `[role="option"]`.
  const {
    onKeyDown: handlePanelKeyDown,
    panelId,
    panelRef,
    triggerRef,
  } = usePopoverPanel({ itemSelector: 'button:not([disabled])' }, open);
  const openUpward = usePopoverFlip(open, triggerRef);

  const close = useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [setOpen, onClose]);

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
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
            'absolute z-50 rounded-md border border-border bg-popover shadow-e2',
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
          data-testid={panelDataTestId}
          id={panelId}
          onKeyDown={handlePanelKeyDown}
          ref={panelRef}
          role={listbox ? 'listbox' : undefined}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
