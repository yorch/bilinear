/**
 * Centralized toast helpers built on sonner.
 * Import this instead of sonner directly so we have a single place to change
 * options (duration, position, etc.) app-wide.
 */
import { toast as sonnerToast, Toaster } from 'sonner';

export const toast = {
  error: (message: string) => sonnerToast.error(message),
  info: (message: string) => sonnerToast.info(message),
  success: (message: string) => sonnerToast.success(message),
  warning: (message: string) => sonnerToast.warning(message),
};

// Re-export the Toaster so the root layout can mount it without importing
// from sonner directly (keeps the "toast access lives in one module" rule).
export { Toaster };
