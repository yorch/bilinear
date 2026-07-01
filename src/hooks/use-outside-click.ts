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
        handler();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    if (closeOnEscape) {
      document.addEventListener('keydown', onKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      if (closeOnEscape) {
        document.removeEventListener('keydown', onKeyDown);
      }
    };
  }, [ref, handler, enabled, closeOnEscape]);
}
