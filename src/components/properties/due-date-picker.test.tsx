import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DueDatePicker } from './due-date-picker';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string>) =>
    vars?.date ? `${key}:${vars.date}` : key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatDueDate: (v: string) => `fmt(${v})` }),
}));

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
