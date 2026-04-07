'use client';

import { useEffect } from 'react';

type Handler = (e: KeyboardEvent) => void;

/**
 * Register a global keyboard shortcut. Fires when the key is pressed
 * and the focus is not inside an input, textarea, or contenteditable element.
 */
export function useHotkeys(
  key: string,
  handler: Handler,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in inputs
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const pressed = [
        e.metaKey && 'meta',
        e.ctrlKey && 'ctrl',
        e.shiftKey && 'shift',
        e.altKey && 'alt',
        e.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join('+');

      if (pressed === key.toLowerCase()) {
        e.preventDefault();
        handler(e);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps array is intentionally spread
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, handler, ...deps]);
}
