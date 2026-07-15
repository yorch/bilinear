'use client';

import { useEffect } from 'react';

type Handler = (e: KeyboardEvent) => void;

interface ParsedBinding {
  key: string;
  mods: Set<string>;
}

function parseBinding(binding: string): ParsedBinding {
  const parts = binding.toLowerCase().split('+');
  return { key: parts[parts.length - 1] ?? '', mods: new Set(parts.slice(0, -1)) };
}

/**
 * Whether a keydown event satisfies a single `[modifier+]key` binding string.
 *
 * Two layout/OS quirks the naive `e.key`-plus-modifier-flags comparison gets
 * wrong:
 *  - Shifted punctuation (e.g. `'?'`, produced by Shift+/) already encodes
 *    Shift in `e.key` itself — requiring an explicit `shift` modifier match
 *    would mean a plain `'?'` binding never fires. Only alphanumeric keys
 *    need the modifier flag checked explicitly (Shift changes their case,
 *    which `.toLowerCase()` erases).
 *  - Alt+digit combos produce OS-composed characters on macOS keyboard
 *    layouts (e.g. Alt+1 does not yield `e.key === '1'`), so those are
 *    matched against the physical `e.code` instead.
 */
function eventMatchesBinding(e: KeyboardEvent, binding: string): boolean {
  const { key, mods } = parseBinding(binding);
  const wantMeta = mods.has('meta');
  const wantCtrl = mods.has('ctrl');
  const wantAlt = mods.has('alt');
  const wantShift = mods.has('shift');

  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.altKey !== wantAlt) {
    return false;
  }

  if (wantAlt && /^[0-9]$/.test(key)) {
    // Match the physical digit key AND shift state explicitly — `e.key`
    // can't be trusted here (that's the whole reason we fell back to
    // `e.code`), so an unrequested Shift has to be checked the same way
    // the alphanumeric branch below does, or e.g. `alt+shift+1` would
    // spuriously satisfy a plain `alt+1` binding.
    return e.code === `Digit${key}` && e.shiftKey === wantShift;
  }

  const eventKey = e.key;
  const isAlphaNumeric = eventKey.length === 1 && /^[a-z0-9]$/i.test(eventKey);

  if (isAlphaNumeric) {
    return e.shiftKey === wantShift && eventKey.toLowerCase() === key;
  }

  // Non-alphanumeric key (punctuation, 'escape', 'enter', etc.): e.key already
  // reflects any Shift that was required to produce it, so only enforce an
  // explicit 'shift' modifier when the binding actually asked for one.
  if (wantShift && !e.shiftKey) {
    return false;
  }
  return eventKey.toLowerCase() === key;
}

// Elements the browser natively activates on a bare (unmodified) Enter or
// Space keypress — a focused element matching one of these already gets its
// own click/activation from the keydown, independent of any global hotkey.
const NATIVE_ACTIVATION_SELECTOR = 'button, a[href], [role="button"], input, textarea, select';

/**
 * Whether `target` is an element the browser would natively activate (or
 * otherwise already handle) on a bare Enter/Space keypress — a focused
 * button, link, form control, or contenteditable region. Used to suppress a
 * plain-key/Enter *hotkey* handler in that case so a single keypress doesn't
 * both activate the focused control AND run an unrelated global handler
 * (e.g. focusing a row-action button and pressing Enter shouldn't both click
 * the button and open the list's detail panel via its global 'enter' hotkey).
 */
function isNativeActivationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return (target as HTMLElement).isContentEditable || target.matches(NATIVE_ACTIVATION_SELECTOR);
}

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
 * Pass an array to bind the same handler to multiple keys (e.g. `['meta+k', 'ctrl+k']`
 * for cross-platform shortcuts). Each key gets one event listener.
 *
 * By default, shortcuts are suppressed when focus is inside an input element.
 * Pass `{ allowInInput: true }` to override this for global shortcuts like Cmd+K.
 */
export function useHotkeys(
  key: string | string[],
  handler: Handler,
  options: HotkeyOptions = {},
  deps: unknown[] = [],
) {
  const { allowInInput = false, enabled = true } = options;
  const keys = Array.isArray(key) ? key : [key];

  // biome-ignore lint/correctness/useExhaustiveDependencies: keys tracked via join; keys.some is stable
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Respect the Escape contract (see CLAUDE.md): whichever surface
      // consumes a key claims it via preventDefault, and any other
      // window-level listener on the same event must back off.
      if (e.defaultPrevented) {
        return;
      }

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

      const matched = keys.find(k => eventMatchesBinding(e, k));
      if (!matched) {
        return;
      }

      // Bare Enter (and Space) is a plain activation key. When the focused
      // element is one the browser natively activates on that keypress (a
      // button, link, form control, or contenteditable region), defer to
      // that native behavior entirely and skip this hotkey's handler — else
      // a single keypress both activates the focused control AND runs a
      // global handler (e.g. focusing a row-action button and pressing
      // Enter would both click the button and open the issues list's
      // detail panel via its global 'enter' hotkey). Modified variants
      // (e.g. 'shift+enter') aren't bare activation keys, so they're
      // unaffected — `matched` only equals the plain key string here.
      const matchedKey = matched.toLowerCase();
      const isBareActivationKey = matchedKey === 'enter' || matchedKey === 'space';
      if (isBareActivationKey && isNativeActivationTarget(e.target)) {
        return;
      }

      // Bare Enter is a plain activation key — e.g. a focused button relies
      // on its own default keydown/click behavior to fire. Only preventDefault
      // for bindings that actually need to suppress the browser default.
      if (matchedKey !== 'enter') {
        e.preventDefault();
      }
      handler(e);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keys.join(','), enabled, allowInInput, handler, ...deps]);
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
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
