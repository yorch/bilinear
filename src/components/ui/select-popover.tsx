'use client';

import type { ReactNode } from 'react';
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
  const { open, setOpen, ref } = usePopover({ forceOpen, onClose });

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className={cn(
          'flex items-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800',
          triggerClassName,
        )}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={triggerTitle}
        type="button"
      >
        {triggerChildren}
      </button>
      {open && (
        <div
          className={cn(
            'absolute top-full z-50 mt-1 rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
          data-testid={panelDataTestId}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
