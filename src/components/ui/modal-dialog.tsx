'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

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

/** Title bar for a form-shaped ModalDialog — border-b + h2. */
export function ModalHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-border px-5 py-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
  );
}

interface ModalFooterProps {
  cancelLabel: string;
  onCancel: () => void;
  submitDisabled?: boolean;
  submitError?: string;
  submitLabel: string;
}

/**
 * Cancel/submit action bar for a form-shaped ModalDialog — border-t +
 * inline error + ghost/default Button pair. Shared by the create-project,
 * create-team, and save-view modals; create-issue-modal's footer carries
 * an extra control so it composes its own Buttons instead of this.
 */
export function ModalFooter({
  cancelLabel,
  onCancel,
  submitDisabled,
  submitError,
  submitLabel,
}: ModalFooterProps) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
      {submitError && <p className="flex-1 text-xs text-destructive">{submitError}</p>}
      <Button onClick={onCancel} size="sm" type="button" variant="ghost">
        {cancelLabel}
      </Button>
      <Button disabled={submitDisabled} size="sm" type="submit">
        {submitLabel}
      </Button>
    </div>
  );
}
