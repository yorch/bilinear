'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ModalDialogProps {
  'aria-label': string;
  children: ReactNode;
  maxWidth?: 'md' | 'lg';
  onClose: () => void;
  open: boolean;
}

export function ModalDialog({
  'aria-label': ariaLabel,
  children,
  maxWidth = 'md',
  onClose,
  open,
}: ModalDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <dialog
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/40 p-0 m-0 border-none max-w-none max-h-none"
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          onClose();
        }
      }}
      open
    >
      <div
        className={cn(
          'w-full rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900',
          maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md',
        )}
      >
        {children}
      </div>
    </dialog>
  );
}
