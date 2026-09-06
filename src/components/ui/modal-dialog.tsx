'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface ModalDialogProps {
  'aria-label': string;
  children: ReactNode;
  maxWidth?: 'md' | 'lg' | 'xl';
  onClose: () => void;
  open: boolean;
}

const MAX_WIDTH_CLASS = {
  lg: 'sm:max-w-lg',
  md: 'sm:max-w-md',
  xl: 'sm:max-w-xl',
} as const;

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
  // A form control marked `data-autofocus` (the same opt-in `usePopoverPanel`
  // honours) takes focus on open, so a modal never needs its own
  // `setTimeout(() => ref.current?.focus())` effect — four of them used to
  // race the dialog's native focus step.
  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      dialog?.close();
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <dialog
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex h-screen w-screen items-end justify-center bg-black/40 p-0 m-0 border-none max-w-none max-h-none sm:items-center"
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
      {/*
       * Below `sm` this renders as a bottom sheet (flush with the screen
       * edge, only top corners rounded, full width) instead of a centered
       * card — thumb-reachable and edge-to-edge on a phone. `max-h-[90vh]
       * overflow-y-auto` caps height so tall content (e.g. create-issue's
       * description editor) scrolls internally instead of pushing the
       * footer off-screen. This clips an absolutely-positioned popover that
       * would otherwise render past this container's edge (e.g. a property
       * picker anchored near the bottom), so SelectPopover/SearchableSelectPopover
       * flip to open upward when there isn't room below (see usePopoverFlip).
       */}
      <div
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-t-xl border border-border bg-card shadow-e3 sm:rounded-xl',
          MAX_WIDTH_CLASS[maxWidth],
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
