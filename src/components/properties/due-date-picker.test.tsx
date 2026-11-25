import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DueDatePicker } from './due-date-picker';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars?.date ? `${key}:${vars.date}` : key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatDueDate: (v: string) => `fmt(${v})`, intlLocale: 'en-US' }),
}));

afterEach(cleanup);

describe('DueDatePicker accessible names', () => {
  it('gives the empty start-date and due-date chips different names', () => {
    render(
      <>
        <DueDatePicker kind="start" onChange={vi.fn()} value={null} />
        <DueDatePicker onChange={vi.fn()} value={null} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'properties.startDate.noStartDate' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'properties.dueDate.noDueDate' })).toBeTruthy();
  });

  it('names a set date by its field, not by the bare date text', () => {
    render(
      <>
        <DueDatePicker kind="start" onChange={vi.fn()} value="2026-12-01" />
        <DueDatePicker onChange={vi.fn()} value="2026-12-02" />
      </>,
    );
    expect(
      screen.getByRole('button', { name: 'properties.startDate.startsOn:fmt(2026-12-01)' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'properties.dueDate.dueOn:fmt(2026-12-02)' }),
    ).toBeTruthy();
  });
});

describe('DueDatePicker calendar panel', () => {
  const open = (props: Partial<Parameters<typeof DueDatePicker>[0]> = {}) => {
    const onChange = vi.fn();
    const utils = render(<DueDatePicker onChange={onChange} value={null} {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /noDueDate|dueOn/ }));
    return { onChange, ...utils };
  };

  it('uses the themed calendar, not a native date input', () => {
    const { container } = open({ value: '2026-03-05' });
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole('grid')).toBeTruthy();
  });

  it('opens focused on the selected day, so the first Enter cannot clear the date', () => {
    const { onChange } = open({ value: '2026-03-05' });
    const day = screen.getByRole('button', { name: 'Thursday, March 5, 2026' });
    expect(document.activeElement).toBe(day);
    fireEvent.keyDown(day, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalledWith(null);
    // The clear action is present but is not what holds focus.
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: 'properties.dueDate.clearDate' }),
    );
  });

  it('opens focused on the typed-entry input when no date is set', () => {
    open();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'calendar.dateInput' }),
    );
  });

  it('emits the clicked day and closes; clear emits null', () => {
    const { onChange } = open({ value: '2026-03-05' });
    fireEvent.click(screen.getByRole('button', { name: 'Thursday, March 12, 2026' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-03-12');
    expect(screen.queryByRole('grid')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /dueOn/ }));
    fireEvent.click(screen.getByRole('button', { name: 'properties.dueDate.clearDate' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('commits a typed date on Enter but refuses one outside min/max', () => {
    const { onChange } = open({ max: '2026-12-31', min: '2026-01-01' });
    const input = screen.getByRole('textbox', { name: 'calendar.dateInput' });
    fireEvent.change(input, { target: { value: '2027-02-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('calendar.outOfRange');
    fireEvent.change(input, { target: { value: '2026-06-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('2026-06-15');
  });

  it('keeps the presets', () => {
    open();
    expect(screen.getByText('properties.dueDate.today')).toBeTruthy();
  });
});

describe('DueDatePicker labelBelowLg', () => {
  it('labels an empty chip and a set chip, hidden from lg up', () => {
    render(
      <>
        <DueDatePicker labelBelowLg="Due date" onChange={vi.fn()} value={null} />
        <DueDatePicker
          kind="start"
          labelBelowLg="Start date"
          onChange={vi.fn()}
          value="2026-12-01"
        />
      </>,
    );
    const empty = screen.getByText('Due date');
    const set = screen.getByText('Start date');
    expect(empty.className).toContain('lg:hidden');
    expect(set.className).toContain('lg:hidden');
  });
});
