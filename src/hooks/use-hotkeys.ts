'use client';

import { useEffect } from 'react';

type Handler = (e: KeyboardEvent) => void;

export interface HotkeyOptions {
  /**
   * When true, the shortcut fires even when focus is inside an input,
   * textarea, or contenteditable element. Useful for Cmd+K style shortcuts
   * that should work from anywhere.
   * @default false
   */
  allowInInput?: boolean;
  /**
   * When false the listener is not registered. Useful for conditionally
   * enabling shortcuts (e.g., only when an issue is selected).
   * @default true
   */
  enabled?: boolean;
}

/**
 * Register a global keyboard shortcut.
 *
 * The key string follows the format: `[modifier+]key`
 * Modifiers: `meta`, `ctrl`, `shift`, `alt`
 * Examples: `'c'`, `'meta+k'`, `'ctrl+k'`, `'shift+e'`, `'escape'`
 *
 * By default, shortcuts are suppressed when focus is inside an input element.
 * Pass `{ allowInInput: true }` to override this for global shortcuts like Cmd+K.
 */
export function useHotkeys(
  key: string,
  handler: Handler,
  options: HotkeyOptions = {},
  deps: unknown[] = [],
) {
  const { allowInInput = false, enabled = true } = options;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!allowInInput) {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, allowInInput, handler, ...deps]);
}

/**
 * Register a two-key sequential chord shortcut (e.g., "G then I").
 *
 * The first key starts a 1-second window during which the second key must
 * be pressed. Both keys are single characters (no modifiers). The chord is
 * suppressed when focus is inside an input.
 *
 * Caveat: if a separate `useHotkeys` is registered for the same first key (e.g.
 * another `useHotkeys('g', ...)`) both handlers will fire when that key is
 * pressed alone. Currently no standalone 'g' shortcut exists in the codebase, so
 * this is safe. If one is added in future, give the chord priority by checking a
 * shared "awaiting chord" ref before running the standalone handler.
 */
export function useChord(
  firstKey: string,
  secondKey: string,
  handler: Handler,
  deps: unknown[] = [],
) {
  useEffect(() => {
    let awaitingSecond = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        awaitingSecond = false;
        if (timer) {
          clearTimeout(timer);
        }
        return;
      }

      // Ignore events with modifier keys for chord sequences
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      const key = e.key.toLowerCase();

      if (!awaitingSecond && key === firstKey.toLowerCase()) {
        e.preventDefault();
        awaitingSecond = true;
        timer = setTimeout(() => {
          awaitingSecond = false;
        }, 1000);
        return;
      }

      if (awaitingSecond) {
        if (timer) {
          clearTimeout(timer);
        }
        awaitingSecond = false;
        if (key === secondKey.toLowerCase()) {
          e.preventDefault();
          handler(e);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer) {
        clearTimeout(timer);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, secondKey, handler, ...deps]);
}
