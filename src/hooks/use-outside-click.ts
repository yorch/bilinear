import { type RefObject, useEffect } from 'react';

/**
 * Calls `handler` when a mousedown event fires outside the given element.
 * Pass `enabled = false` to disable the listener (e.g. when a popover is closed).
 */
export function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler, enabled]);
}
