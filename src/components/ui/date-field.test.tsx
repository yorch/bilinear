import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateField } from './date-field';

vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({
    formatDate: (d: Date) => `d${d.getDate()}`,
    intlLocale: 'en-US',
  }),
}));

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
    fireEvent.click(screen.getByRole('button', { name: '12' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-03-12');
    expect(screen.queryByRole('button', { name: '12' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'From: d5' }));
    fireEvent.click(screen.getByRole('button', { name: 'calendar.clear' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
