import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Calendar, isDateDisabled, parseDateKey } from './calendar';

vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/hooks/use-formatters', () => ({ useFormatters: () => ({ intlLocale: 'en-US' }) }));

describe('Calendar', () => {
  it('opens on the selected month and marks the selected day', () => {
    render(<Calendar onChange={vi.fn()} value="2026-03-05" />);
    expect(screen.getByText('March 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: '5' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '6' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('emits YYYY-MM-DD, including after paging months', () => {
    const onChange = vi.fn();
    render(<Calendar onChange={onChange} value="2026-01-31" />);
    fireEvent.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    expect(screen.getByText('February 2026')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    expect(onChange).toHaveBeenCalledWith('2026-02-09');
  });

  it('disables days outside min/max and does not emit for them', () => {
    const onChange = vi.fn();
    render(<Calendar max="2026-03-20" min="2026-03-10" onChange={onChange} value="2026-03-15" />);
    const nine = screen.getByRole('button', { name: '9' }) as HTMLButtonElement;
    const twentyOne = screen.getByRole('button', { name: '21' }) as HTMLButtonElement;
    expect(nine.disabled).toBe(true);
    expect(twentyOne.disabled).toBe(true);
    fireEvent.click(nine);
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '10' }) as HTMLButtonElement).disabled).toBe(false);
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
