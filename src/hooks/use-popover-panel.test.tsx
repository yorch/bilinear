import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePopoverPanel } from './use-popover-panel';

/**
 * This hook is the single point of failure for every popover panel in the app,
 * and it regressed twice in one branch before anything caught it — both times by
 * deciding initial focus from a CSS selector and getting the wrong element. The
 * assertions below are written against those exact failures: a panel whose first
 * focusable is a form control, and a panel that names its own target.
 */

const OPTION = '[role="option"]';
const BUTTONS = 'button:not([disabled])';

/**
 * Renders `html` into a real panel div, points the hook's ref at it, and returns
 * whatever ends up focused. `renderHook` cannot attach the ref to markup it does
 * not own, so the panel is built by hand and the ref assigned before the effect
 * that reads it runs on the next render.
 */
function focusAfterOpen(html: string, itemSelector: string) {
  const panel = document.createElement('div');
  panel.innerHTML = html;
  document.body.append(panel);

  const { rerender, result } = renderHook(
    ({ open }: { open: boolean }) => usePopoverPanel({ itemSelector }, open),
    { initialProps: { open: false } },
  );
  (result.current.panelRef as { current: HTMLDivElement | null }).current = panel;
  rerender({ open: true });

  return { focused: document.activeElement, panel, result };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('usePopoverPanel', () => {
  describe('focus on open', () => {
    it('focuses a form control that precedes the buttons', () => {
      // The due-date panel: a date field, then "Clear date" only when a date is
      // set. Focusing the button meant the first Enter wiped the date.
      const { focused } = focusAfterOpen(
        '<input type="date" /><button type="button">Clear date</button>',
        BUTTONS,
      );

      expect((focused as HTMLElement).tagName).toBe('INPUT');
    });

    it('focuses a panel of checkboxes that contains no button at all', () => {
      // The column picker. A button-only selector matched nothing here, so focus
      // silently stayed on the trigger and roving never engaged.
      const { focused } = focusAfterOpen(
        '<label><input type="checkbox" id="first" /></label><label><input type="checkbox" /></label>',
        BUTTONS,
      );

      expect((focused as HTMLElement).id).toBe('first');
    });

    it('prefers an element that claims focus over document order', () => {
      const { focused } = focusAfterOpen(
        '<button type="button">Clear</button><input data-autofocus id="claimed" />',
        BUTTONS,
      );

      expect((focused as HTMLElement).id).toBe('claimed');
    });

    it('prefers the selected option over the first one', () => {
      const { focused } = focusAfterOpen(
        '<button role="option" type="button">A</button>' +
          '<button aria-selected="true" id="current" role="option" type="button">B</button>',
        OPTION,
      );

      expect((focused as HTMLElement).id).toBe('current');
    });

    it('leaves focus alone while closed', () => {
      const panel = document.createElement('div');
      panel.innerHTML = '<button id="opt" type="button">A</button>';
      document.body.append(panel);

      renderHook(() => usePopoverPanel({ itemSelector: BUTTONS }, false));

      expect(document.activeElement).toBe(document.body);
    });
  });

  describe('roving focus', () => {
    function rove(key: string, activeId: string) {
      const panel = document.createElement('div');
      panel.innerHTML =
        '<input id="search" /><button id="a" role="option" type="button">A</button>' +
        '<button id="b" role="option" type="button">B</button>' +
        '<button id="c" role="option" type="button">C</button>';
      document.body.append(panel);

      const { result } = renderHook(() => usePopoverPanel({ itemSelector: OPTION }, true));
      (result.current.panelRef as { current: HTMLDivElement | null }).current = panel;
      document.getElementById(activeId)?.focus();

      let defaultPrevented = false;
      result.current.onKeyDown({
        key,
        preventDefault: () => {
          defaultPrevented = true;
        },
        stopPropagation: () => {},
        target: document.getElementById(activeId),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);

      return { defaultPrevented, focusedId: (document.activeElement as HTMLElement).id };
    }

    it.each([
      ['ArrowDown', 'a', 'b'],
      ['ArrowUp', 'b', 'a'],
      ['Home', 'c', 'a'],
      ['End', 'a', 'c'],
    ])('%s from %s moves to %s', (key, from, to) => {
      expect(rove(key, from).focusedId).toBe(to);
    });

    it('skips the search field the panel may also contain', () => {
      // `itemSelector` is narrower than the focus selector on purpose: arrow
      // keys belong to the list, not to a text input above it.
      expect(rove('ArrowDown', 'c').focusedId).toBe('a');
    });

    it('leaves arrow keys alone when they belong to a text field', () => {
      const panel = document.createElement('div');
      panel.innerHTML =
        '<input id="search" /><button id="a" role="option" type="button">A</button>';
      document.body.append(panel);

      const { result } = renderHook(() => usePopoverPanel({ itemSelector: OPTION }, true));
      (result.current.panelRef as { current: HTMLDivElement | null }).current = panel;

      let defaultPrevented = false;
      result.current.onKeyDown({
        key: 'ArrowDown',
        preventDefault: () => {
          defaultPrevented = true;
        },
        stopPropagation: () => {},
        target: document.getElementById('search'),
      } as unknown as React.KeyboardEvent<HTMLDivElement>);

      expect(defaultPrevented).toBe(false);
    });

    it('ignores keys that are not roving keys', () => {
      expect(rove('a', 'b').defaultPrevented).toBe(false);
    });
  });
});
