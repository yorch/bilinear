import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOverlayOpen, useChord, useHotkeys } from './use-hotkeys';

function dispatchKeyDown(init: KeyboardEventInit, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  (target ?? document).dispatchEvent(event);
  return event;
}

describe('useHotkeys', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('fires on a bare "?" binding (shifted punctuation)', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('?', handler));

    act(() => {
      dispatchKeyDown({ key: '?', shiftKey: true });
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('matches "alt+1" via e.code=Digit1', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('alt+1', handler));

    act(() => {
      // On macOS, Alt+1 doesn't produce e.key === '1' — the hook matches on code.
      dispatchKeyDown({ altKey: true, code: 'Digit1', key: '¡' });
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire "alt+1" on alt+shift+1', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('alt+1', handler));

    act(() => {
      dispatchKeyDown({ altKey: true, code: 'Digit1', key: '¡', shiftKey: true });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire a bare "enter" binding when target is a native interactive element (button)', () => {
    const handler = vi.fn();
    const button = document.createElement('button');
    document.body.appendChild(button);
    renderHook(() => useHotkeys('enter', handler, { allowInInput: true }));

    act(() => {
      dispatchKeyDown({ key: 'Enter' }, button);
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire a bare "enter" binding when target is a native interactive element (input)', () => {
    const handler = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useHotkeys('enter', handler, { allowInInput: true }));

    act(() => {
      dispatchKeyDown({ key: 'Enter' }, input);
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('fires a bare "enter" binding when target is not a native interactive element', () => {
    const handler = vi.fn();
    const div = document.createElement('div');
    document.body.appendChild(div);
    renderHook(() => useHotkeys('enter', handler));

    act(() => {
      dispatchKeyDown({ key: 'Enter' }, div);
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips the handler when e.defaultPrevented is true', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('k', handler, { allowInInput: true }));

    act(() => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'k',
      });
      event.preventDefault();
      document.dispatchEvent(event);
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('suppresses the shortcut while focus is inside an input by default', () => {
    const handler = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useHotkeys('k', handler));

    act(() => {
      dispatchKeyDown({ key: 'k' }, input);
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('allows the shortcut inside an input when allowInInput is true', () => {
    const handler = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useHotkeys('k', handler, { allowInInput: true }));

    act(() => {
      dispatchKeyDown({ key: 'k' }, input);
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not register a listener when enabled is false', () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys('k', handler, { enabled: false }));

    act(() => {
      dispatchKeyDown({ key: 'k' });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useHotkeys('k', handler));
    unmount();

    act(() => {
      dispatchKeyDown({ key: 'k' });
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('useChord', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('fires the handler when the second key follows the first within the window', () => {
    const handler = vi.fn();
    renderHook(() => useChord('g', 'i', handler));

    act(() => {
      dispatchKeyDown({ key: 'g' });
      dispatchKeyDown({ key: 'i' });
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the second key does not match', () => {
    const handler = vi.fn();
    renderHook(() => useChord('g', 'i', handler));

    act(() => {
      dispatchKeyDown({ key: 'g' });
      dispatchKeyDown({ key: 'x' });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('resets the awaiting-second-key window after the timeout elapses', () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    renderHook(() => useChord('g', 'i', handler));

    act(() => {
      dispatchKeyDown({ key: 'g' });
    });

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    act(() => {
      dispatchKeyDown({ key: 'i' });
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not start a chord while focus is inside an input', () => {
    const handler = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    renderHook(() => useChord('g', 'i', handler));

    act(() => {
      dispatchKeyDown({ key: 'g' }, input);
      dispatchKeyDown({ key: 'i' });
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('chord vs single-key hotkeys', () => {
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  // Both registration orders: the fix must not depend on which window
  // listener runs first for the second key's event.
  it.each([
    ['hotkey registered first', true],
    ['chord registered first', false],
  ])('G then I runs the chord and NOT the single-key i (%s)', (_name, hotkeyFirst) => {
    vi.useFakeTimers();
    const single = vi.fn();
    const chord = vi.fn();
    const mountHotkey = () => renderHook(() => useHotkeys('i', single));
    const mountChord = () => renderHook(() => useChord('g', 'i', chord));
    if (hotkeyFirst) {
      mountHotkey();
      mountChord();
    } else {
      mountChord();
      mountHotkey();
    }

    act(() => {
      dispatchKeyDown({ key: 'g' });
      dispatchKeyDown({ key: 'i' });
    });

    expect(chord).toHaveBeenCalledTimes(1);
    expect(single).not.toHaveBeenCalled();
  });

  it('a plain i fires again once the chord has completed', () => {
    vi.useFakeTimers();
    const single = vi.fn();
    renderHook(() => useHotkeys('i', single));
    renderHook(() => useChord('g', 'i', vi.fn()));

    act(() => {
      dispatchKeyDown({ key: 'g' });
      dispatchKeyDown({ key: 'i' });
    });
    act(() => {
      vi.advanceTimersByTime(5);
    });
    act(() => {
      dispatchKeyDown({ key: 'i' });
    });

    expect(single).toHaveBeenCalledTimes(1);
  });

  it('a plain i fires after an abandoned chord times out', () => {
    vi.useFakeTimers();
    const single = vi.fn();
    renderHook(() => useHotkeys('i', single));
    renderHook(() => useChord('g', 'i', vi.fn()));

    act(() => {
      dispatchKeyDown({ key: 'g' });
    });
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    act(() => {
      dispatchKeyDown({ key: 'i' });
    });

    expect(single).toHaveBeenCalledTimes(1);
  });
});

describe('useHotkeys ignoreRepeat', () => {
  it('drops auto-repeat keydowns only when asked to', () => {
    const guarded = vi.fn();
    const open = vi.fn();
    renderHook(() => {
      useHotkeys('1', guarded, { ignoreRepeat: true });
      useHotkeys('j', open);
    });
    act(() => {
      dispatchKeyDown({ key: '1' });
      dispatchKeyDown({ key: '1', repeat: true });
      dispatchKeyDown({ key: '1', repeat: true });
      dispatchKeyDown({ key: 'j', repeat: true });
      dispatchKeyDown({ key: 'j', repeat: true });
    });
    expect(guarded).toHaveBeenCalledTimes(1);
    // Navigation keeps scrolling while held.
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('isOverlayOpen', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is false on a bare page', () => {
    document.body.innerHTML = '<button id="b">x</button>';
    expect(isOverlayOpen()).toBe(false);
  });

  it('sees an open native dialog but not a closed one', () => {
    document.body.innerHTML = '<dialog id="d"></dialog>';
    expect(isOverlayOpen()).toBe(false);
    document.getElementById('d')?.setAttribute('open', '');
    expect(isOverlayOpen()).toBe(true);
  });

  it('sees ARIA dialogs, aria-modal surfaces and expanded popover triggers', () => {
    document.body.innerHTML = '<div role="dialog"></div>';
    expect(isOverlayOpen()).toBe(true);
    document.body.innerHTML = '<div aria-modal="true"></div>';
    expect(isOverlayOpen()).toBe(true);
    document.body.innerHTML = '<button aria-haspopup="listbox" aria-expanded="true"></button>';
    expect(isOverlayOpen()).toBe(true);
    document.body.innerHTML = '<button aria-haspopup="listbox" aria-expanded="false"></button>';
    expect(isOverlayOpen()).toBe(false);
  });
});
