import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePopoverFlip } from './use-popover-flip';

function rect(partial: Partial<DOMRect>): DOMRect {
  return {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...partial,
  };
}

describe('usePopoverFlip', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not flip when the trigger has no ref element yet', () => {
    const ref = { current: null };
    const { result } = renderHook(({ open }) => usePopoverFlip(open, ref), {
      initialProps: { open: true },
    });
    expect(result.current).toBe(false);
  });

  it('resets to false when closed', () => {
    const trigger = document.createElement('div');
    document.body.appendChild(trigger);
    trigger.getBoundingClientRect = () => rect({ bottom: 700, top: 670 });
    const ref = { current: trigger };

    const { result, rerender } = renderHook(({ open }) => usePopoverFlip(open, ref), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    expect(result.current).toBe(false);
  });

  describe('viewport fallback (no scrollable ancestor)', () => {
    it('flips up when there is insufficient room below the trigger', () => {
      // jsdom's default window.innerHeight is 768.
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
      const trigger = document.createElement('div');
      document.body.appendChild(trigger);
      // Only 50px of room below (< 160 threshold) but 700px above.
      trigger.getBoundingClientRect = () => rect({ bottom: 718, top: 700 });
      const ref = { current: trigger };

      const { result } = renderHook(({ open }) => usePopoverFlip(open, ref), {
        initialProps: { open: true },
      });

      expect(result.current).toBe(true);
    });

    it('does not flip when there is plenty of room below the trigger', () => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
      const trigger = document.createElement('div');
      document.body.appendChild(trigger);
      trigger.getBoundingClientRect = () => rect({ bottom: 130, top: 100 });
      const ref = { current: trigger };

      const { result } = renderHook(({ open }) => usePopoverFlip(open, ref), {
        initialProps: { open: true },
      });

      expect(result.current).toBe(false);
    });
  });

  describe('scrollable ancestor boundary', () => {
    function makeScrollableContainer(): HTMLDivElement {
      const container = document.createElement('div');
      container.style.overflowY = 'auto';
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 500 });
      container.getBoundingClientRect = () => rect({ bottom: 600, top: 0 });
      document.body.appendChild(container);
      return container;
    }

    it('flips up when the scrollable container clips the space below, even though the viewport has room', () => {
      const container = makeScrollableContainer();
      const trigger = document.createElement('div');
      container.appendChild(trigger);
      // Near the bottom of the scroll container: only 20px below.
      trigger.getBoundingClientRect = () => rect({ bottom: 580, top: 550 });
      const ref = { current: trigger };

      const { result } = renderHook(({ open }) => usePopoverFlip(open, ref), {
        initialProps: { open: true },
      });

      expect(result.current).toBe(true);
    });

    it('does not flip when there is room below within the scrollable container', () => {
      const container = makeScrollableContainer();
      const trigger = document.createElement('div');
      container.appendChild(trigger);
      trigger.getBoundingClientRect = () => rect({ bottom: 100, top: 70 });
      const ref = { current: trigger };

      const { result } = renderHook(({ open }) => usePopoverFlip(open, ref), {
        initialProps: { open: true },
      });

      expect(result.current).toBe(false);
    });

    it('ignores a non-scrolling overflow:auto ancestor (scrollHeight === clientHeight)', () => {
      const container = document.createElement('div');
      container.style.overflowY = 'auto';
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 500 });
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 500 });
      container.getBoundingClientRect = () => rect({ bottom: 200, top: 0 });
      document.body.appendChild(container);

      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
      const trigger = document.createElement('div');
      container.appendChild(trigger);
      // Would flip against the container's bottom (200), but the container isn't
      // actually scrollable, so this should fall through to the viewport instead
      // (plenty of room below relative to window.innerHeight => no flip).
      trigger.getBoundingClientRect = () => rect({ bottom: 190, top: 160 });
      const ref = { current: trigger };

      const { result } = renderHook(({ open }) => usePopoverFlip(open, ref), {
        initialProps: { open: true },
      });

      expect(result.current).toBe(false);
    });
  });
});
