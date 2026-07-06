/**
 * Centralized toast helpers built on sonner.
 * Import this instead of sonner directly so we have a single place to change
 * options (duration, position, etc.) app-wide.
 */
import { toast as sonnerToast, Toaster } from 'sonner';

export const toast = {
  /** Dismiss a toast by id (or all toasts when no id is given). */
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  error: (message: string) => sonnerToast.error(message),
  info: (message: string) => sonnerToast.info(message),
  /** Persistent spinner toast for long-running work; dismiss via `dismiss(id)`. */
  loading: (message: string) => sonnerToast.loading(message),
  /** Pending → success/error lifecycle for a promise-shaped operation. */
  promise: sonnerToast.promise,
  success: (message: string) => sonnerToast.success(message),
  /**
   * Toast with an inline undo action (Linear-style "Archived — Undo").
   * `onUndo` runs when the user clicks the action before the toast expires.
   */
  undo: (message: string, actionLabel: string, onUndo: () => void) =>
    sonnerToast(message, {
      action: {
        label: actionLabel,
        onClick: onUndo,
      },
    }),
  warning: (message: string) => sonnerToast.warning(message),
};

// Re-export the Toaster so the root layout can mount it without importing
// from sonner directly (keeps the "toast access lives in one module" rule).
export { Toaster };
