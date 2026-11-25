/**
 * Centralized toast helpers built on sonner.
 * Import this instead of sonner directly so we have a single place to change
 * options (duration, position, etc.) app-wide.
 */
import { type CSSProperties, createElement } from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast, type ToasterProps } from 'sonner';

export const toast = {
  /** Dismiss a toast by id (or all toasts when no id is given). */
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  error: (message: string) => sonnerToast.error(message),
  info: (message: string) => sonnerToast.info(message),
  /** Persistent spinner toast for long-running work; dismiss via `dismiss(id)`. */
  loading: (message: string) => sonnerToast.loading(message),
  /** Pending → success/error lifecycle for a promise-shaped operation. */
  promise: sonnerToast.promise,
  success: (message: string, action?: { label: string; onClick: () => void }) =>
    sonnerToast.success(message, action ? { action } : undefined),
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

/**
 * Sonner ships its own light/dark palettes (pale-blue info, near-white normal)
 * and picks between them from a `theme` prop that defaults to light — which is
 * why an info toast stayed a pale-blue slab on a dark page. The app themes with a
 * class (next-themes), not `prefers-color-scheme`, so rather than mirror the
 * theme into sonner we point every sonner colour variable at our tokens: they
 * already switch with `.dark` and the accent, and status roles never follow it.
 *
 * Tinted fills are mixed into `--popover` rather than using the translucent
 * `-subtle` tokens directly: a toast floats over list rows and must be opaque.
 * Every surface (fill AND border) is therefore either `--popover` itself or a
 * mix whose base is `--popover`; `--border` is a translucent hairline, so the
 * neutral border is mixed too. Nothing here may be `transparent` or an alpha token.
 */
const tint = (role: 'danger' | 'info' | 'success' | 'warning') =>
  `color-mix(in oklab, var(--${role}) 14%, var(--popover))`;
const edge = (role: 'danger' | 'info' | 'success' | 'warning') =>
  `color-mix(in oklab, var(--${role}) 35%, var(--popover))`;

const TOAST_THEME = {
  '--error-bg': tint('danger'),
  '--error-border': edge('danger'),
  '--error-text': 'var(--danger-subtle-foreground)',
  // Sonner's own greys. `--gray2`/`--gray5` paint the close button on hover
  // (a rule that outranks the per-type colours) and sonner runs in its light
  // theme, so unmapped they are near-white discs in `.dark`. `--gray11` is the
  // loading spinner bar.
  '--gray2': 'color-mix(in oklab, var(--foreground) 8%, var(--popover))',
  '--gray4': 'color-mix(in oklab, var(--foreground) 12%, var(--popover))',
  '--gray5': 'color-mix(in oklab, var(--foreground) 20%, var(--popover))',
  '--gray11': 'var(--muted-foreground)',
  '--info-bg': tint('info'),
  '--info-border': edge('info'),
  '--info-text': 'var(--info-subtle-foreground)',
  '--normal-bg': 'var(--popover)',
  '--normal-border': `color-mix(in oklab, var(--foreground) 12%, var(--popover))`,
  '--normal-text': 'var(--popover-foreground)',
  '--success-bg': tint('success'),
  '--success-border': edge('success'),
  '--success-text': 'var(--success-subtle-foreground)',
  '--warning-bg': tint('warning'),
  '--warning-border': edge('warning'),
  '--warning-text': 'var(--warning-subtle-foreground)',
} as CSSProperties;

/**
 * Below `md` (768px) the bulk-action bar is docked to the bottom edge, so
 * toasts sit above it instead of covering the rows it just acted on. The bar
 * publishes its measured height as `--bulk-bar-height` on <html> (it wraps to a
 * varying number of rows); the fallback only covers the frame before it
 * measures. Sonner sets its offset inline at both of its breakpoints, hence the
 * important modifier.
 */
const ABOVE_BULK_BAR =
  '[body:has([data-testid=bulk-action-bar])_&]:max-md:bottom-[calc(var(--bulk-bar-height,6.5rem)+0.5rem)]!';

/** Mounts sonner with the app's theming; accepts the same props. */
export function Toaster(props: ToasterProps) {
  return createElement(SonnerToaster, {
    ...props,
    className: [ABOVE_BULK_BAR, props.className].filter(Boolean).join(' '),
    style: { ...TOAST_THEME, ...props.style },
  });
}
