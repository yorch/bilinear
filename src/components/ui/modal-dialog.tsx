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
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismissal is the native <dialog> cancel event (Escape), handled via onCancel
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
      ref={dialogRef}
    >
      <div
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900',
          maxWidth === 'lg' ? 'max-w-lg' : 'max-w-md',
        )}
      >
        {children}
      </div>
    </dialog>
  );
}
