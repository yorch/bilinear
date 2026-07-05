'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface ModalDialogProps {
  'aria-label': string;
  children: ReactNode;
  maxWidth?: 'md' | 'lg';
  onClose: () => void;
  open: boolean;
}

export function ModalDialog(props: ModalDialogProps) {
  if (!props.open) {
    return null;
  }
  return <ModalDialogInner {...props} />;
}

function ModalDialogInner({
  'aria-label': ariaLabel,
  children,
  maxWidth = 'md',
  onClose,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // showModal() gives us the native top layer, focus trap, and inert
  // background; closing restores focus to the previously focused element.
  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <dialog
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex h-screen w-screen items-center justify-center bg-black/40 p-0 m-0 border-none max-w-none max-h-none"
      onCancel={e => {
        // Escape fires `cancel`; let React state drive the unmount instead
        // of the native close so `open` stays the single source of truth.
        e.preventDefault();
        onClose();
      }}
      onClick={e => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onKeyDown={e => {
        // Keep the Escape keydown inside the dialog so window-level Escape
        // handlers (e.g. the issue detail panel) don't also close their
        // surface; the native `cancel` event still handles the dismissal.
        if (e.key === 'Escape') {
          e.stopPropagation();
        }
      }}
      ref={dialogRef}
    >
      {/* No overflow clipping here: property dropdowns inside modals render
          position:absolute panels that must overflow the dialog box. */}
      <div
        className={cn(
          'w-full rounded-xl border border-border bg-card shadow-2xl',
          maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md',
        )}
      >
        {children}
      </div>
    </dialog>
  );
}
