import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Calendar, isDateDisabled, parseDateKey, parseTypedDate } from './calendar';

vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ intlLocale: 'en-US' }) }));

const day = (name: string) => screen.getByRole('button', { name });
const cell = (name: string) => day(name).closest('td') as HTMLElement;

describe('Calendar', () => {
  it('opens on the selected month and marks the selected day with aria-selected', () => {
    render(<Calendar onChange={vi.fn()} value="2026-03-05" />);
    expect(screen.getByText('March 2026', { selector: 'span' })).toBeTruthy();
    expect(cell('Thursday, March 5, 2026').getAttribute('aria-selected')).toBe('true');
    expect(cell('Friday, March 6, 2026').getAttribute('aria-selected')).toBe('false');
    expect(day('Thursday, March 5, 2026').hasAttribute('aria-pressed')).toBe(false);
  });

  it('names every day with its full date and flags today with aria-current', () => {
    vi.useFakeTimers({ now: new Date(2026, 2, 10, 12) });
    try {
      render(<Calendar onChange={vi.fn()} value="" />);
      expect(day('Tuesday, March 10, 2026').getAttribute('aria-current')).toBe('date');
      expect(day('Wednesday, March 11, 2026').hasAttribute('aria-current')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits YYYY-MM-DD, including after paging months', () => {
    const onChange = vi.fn();
    render(<Calendar onChange={onChange} value="2026-01-31" />);
    fireEvent.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    expect(screen.getByText('February 2026', { selector: 'span' })).toBeTruthy();
    fireEvent.click(day('Monday, February 9, 2026'));
    expect(onChange).toHaveBeenCalledWith('2026-02-09');
  });

  it('disables days outside min/max and does not emit for them', () => {
    const onChange = vi.fn();
    render(<Calendar max="2026-03-20" min="2026-03-10" onChange={onChange} value="2026-03-15" />);
    const nine = day('Monday, March 9, 2026') as HTMLButtonElement;
    expect(nine.disabled).toBe(true);
    expect((day('Saturday, March 21, 2026') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(nine);
    expect(onChange).not.toHaveBeenCalled();
    expect((day('Tuesday, March 10, 2026') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables prev/next once the adjacent month is entirely out of bounds', () => {
    render(<Calendar max="2026-03-20" min="2026-03-01" onChange={vi.fn()} value="2026-03-15" />);
    expect(
      (screen.getByRole('button', { name: 'calendar.previousMonth' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'calendar.nextMonth' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('keeps prev enabled while the previous month still has an allowed day', () => {
    render(<Calendar min="2026-02-28" onChange={vi.fn()} value="2026-03-15" />);
    expect(
      (screen.getByRole('button', { name: 'calendar.previousMonth' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it('has a single tab stop: the selected day', () => {
    render(<Calendar onChange={vi.fn()} value="2026-03-15" />);
    const stops = screen.getAllByRole('button').filter(c => c.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('data-date')).toBe('2026-03-15');
    expect(stops[0]?.hasAttribute('data-autofocus')).toBe(true);
  });

  describe('keyboard', () => {
    const press = (from: string, key: string, init: object = {}) => {
      const el = day(from);
      el.focus();
      fireEvent.keyDown(el, { key, ...init });
    };
    const focused = () => document.activeElement?.getAttribute('data-date');

    it('arrows move one day / one week, across month edges', () => {
      render(<Calendar onChange={vi.fn()} value="2026-03-31" />);
      press('Tuesday, March 31, 2026', 'ArrowRight');
      expect(focused()).toBe('2026-04-01');
      expect(screen.getByText('April 2026', { selector: 'span' })).toBeTruthy();
      press('Wednesday, April 1, 2026', 'ArrowDown');
      expect(focused()).toBe('2026-04-08');
      press('Wednesday, April 8, 2026', 'ArrowUp');
      expect(focused()).toBe('2026-04-01');
      press('Wednesday, April 1, 2026', 'ArrowLeft');
      expect(focused()).toBe('2026-03-31');
    });

    it('Home/End go to the row ends (Sunday-first in en-US)', () => {
      render(<Calendar onChange={vi.fn()} value="2026-03-11" />);
      press('Wednesday, March 11, 2026', 'Home');
      expect(focused()).toBe('2026-03-08');
      press('Sunday, March 8, 2026', 'End');
      expect(focused()).toBe('2026-03-14');
    });

    it('PageUp/PageDown step months (clamping the day); Shift steps years', () => {
      render(<Calendar onChange={vi.fn()} value="2026-03-31" />);
      press('Tuesday, March 31, 2026', 'PageDown');
      expect(focused()).toBe('2026-04-30');
      press('Thursday, April 30, 2026', 'PageUp', { shiftKey: true });
      expect(focused()).toBe('2025-04-30');
      expect(screen.getByText('April 2025', { selector: 'span' })).toBeTruthy();
      press('Wednesday, April 30, 2025', 'PageDown', { shiftKey: true });
      expect(focused()).toBe('2026-04-30');
    });

    it('clamps navigation to min/max and claims the key from an enclosing popover', () => {
      const outer = vi.fn();
      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: test spy for event bubbling
        <div onKeyDown={outer}>
          <Calendar max="2026-03-20" min="2026-03-10" onChange={vi.fn()} value="2026-03-12" />
        </div>,
      );
      press('Thursday, March 12, 2026', 'PageUp', { shiftKey: true });
      expect(focused()).toBe('2026-03-10');
      press('Tuesday, March 10, 2026', 'PageDown', { shiftKey: true });
      expect(focused()).toBe('2026-03-20');
      expect(outer).not.toHaveBeenCalled();
    });

    it('Enter/Space activation stays with the button (no custom handling)', () => {
      const onChange = vi.fn();
      render(<Calendar onChange={onChange} value="2026-03-12" />);
      fireEvent.keyDown(day('Thursday, March 12, 2026'), { key: 'Enter' });
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});

describe('parseTypedDate', () => {
  it('accepts ISO and locale-ordered dates, rejects the rest', () => {
    expect(parseTypedDate('2026-03-05')).toBe('2026-03-05');
    expect(parseTypedDate('2026-3-5')).toBe('2026-03-05');
    expect(parseTypedDate('3/5/2026', 'en-US')).toBe('2026-03-05');
    expect(parseTypedDate('05/03/2026', 'es-ES')).toBe('2026-03-05');
    expect(parseTypedDate('2026-02-30')).toBeNull();
    expect(parseTypedDate('13/13/2026', 'en-US')).toBeNull();
    expect(parseTypedDate('3/5/26', 'en-US')).toBeNull();
    expect(parseTypedDate('soon')).toBeNull();
  });
});

describe('date helpers', () => {
  it('rejects impossible dates', () => {
    expect(parseDateKey('2026-02-30')).toBeNull();
    expect(parseDateKey('')).toBeNull();
    expect(parseDateKey('2026-02-28T10:00:00Z')).toEqual([2026, 1, 28]);
  });
  it('compares bounds inclusively', () => {
    expect(isDateDisabled('2026-03-10', '2026-03-10', '2026-03-10')).toBe(false);
    expect(isDateDisabled('2026-03-11', undefined, '2026-03-10')).toBe(true);
  });
});
