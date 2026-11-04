import { type RefObject, useEffect, useRef } from 'react';

/**
 * Mobile drawer behaviour: move focus in on open, hand it back on close, and
 * let Escape close it. Everything outside is made inert by AppShell, which is
 * what keeps Tab inside; below `md` the closed drawer is `invisible`.
 *
 * `onClose` is read through a ref so a caller passing a fresh function each
 * render doesn't re-run the effect (which re-captured the "opener" and pulled
 * focus back to the close button after any in-drawer interaction).
 */
export function useMobileDrawer(
  open: boolean,
  onClose: (() => void) | undefined,
  closeButtonRef: RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // biome-ignore lint/correctness/useExhaustiveDependencies: closeButtonRef is a stable ref object
  useEffect(() => {
    if (!open) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }
      // An open dialog, menu, popover or text field keeps first claim on Escape.
      const target = e.target instanceof Element ? e.target : null;
      if (
        target?.closest('input, textarea, [contenteditable="true"], dialog, [role="menu"]') ||
        document.querySelector('[aria-haspopup][aria-expanded="true"]')
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current?.();
    };
    // Capture phase: pages register bubble-phase Escape handlers (the issue
    // lists' clear-selection) that preventDefault first, which left the drawer
    // stuck open. While the drawer is open it is the topmost surface.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      if (opener?.isConnected) {
        opener.focus();
      }
    };
  }, [open]);
}
