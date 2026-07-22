import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChord, useHotkeys } from './use-hotkeys';

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
