import { type RefObject, useEffect } from 'react';

/**
 * Calls `handler` when a mousedown event fires outside the given element.
 * Pass `enabled = false` to disable the listener (e.g. when a popover is closed).
 * Pass `closeOnEscape = true` to also call `handler` when Escape is pressed.
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
  closeOnEscape = false,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Claim the keypress: preventDefault stops a surrounding native
        // <dialog> from also cancelling, and stopPropagation keeps
        // window-level Escape handlers (issue detail panel, modals) from
        // closing the parent surface on the same keypress.
        e.preventDefault();
        e.stopPropagation();
        handler();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    if (closeOnEscape) {
      // Capture phase so this runs before bubble-phase handlers on enclosing
      // surfaces (native <dialog> onKeyDown, window listeners) — an open
      // popover always wins the Escape and dismisses only itself.
      document.addEventListener('keydown', onKeyDown, true);
    }
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      if (closeOnEscape) {
        document.removeEventListener('keydown', onKeyDown, true);
      }
    };
  }, [ref, handler, enabled, closeOnEscape]);
}
