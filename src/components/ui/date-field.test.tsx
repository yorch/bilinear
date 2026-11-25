import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateField } from './date-field';

vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({
    formatDate: (d: Date) => `d${d.getDate()}`,
    intlLocale: 'en-US',
  }),
}));

afterEach(cleanup);

describe('DateField', () => {
  it('shows its label while empty and has no native date input', () => {
    const { container } = render(<DateField ariaLabel="From" onChange={vi.fn()} value="" />);
    expect(screen.getByRole('button', { name: 'From' })).toBeTruthy();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('picks a day, emits it and closes; clear emits an empty string', () => {
    const onChange = vi.fn();
    render(<DateField ariaLabel="From" onChange={onChange} value="2026-03-05" />);
    fireEvent.click(screen.getByRole('button', { name: 'From: d5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thursday, March 12, 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-03-12');
    expect(screen.queryByRole('button', { name: 'Thursday, March 12, 2026' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'From: d5' }));
    fireEvent.click(screen.getByRole('button', { name: 'calendar.clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('accepts a typed far date on Enter, honouring min/max', () => {
    const onChange = vi.fn();
    render(
      <DateField ariaLabel="From" max="2026-12-31" min="2024-01-01" onChange={onChange} value="" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'From' }));
    const input = screen.getByRole('textbox', { name: 'calendar.dateInput' });

    fireEvent.change(input, { target: { value: 'nonsense' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('calendar.invalidDate');

    fireEvent.change(input, { target: { value: '2019-05-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('calendar.outOfRange');

    fireEvent.change(input, { target: { value: '2024-06-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2024-06-15');
    expect(screen.queryByRole('textbox', { name: 'calendar.dateInput' })).toBeNull();
  });
});
