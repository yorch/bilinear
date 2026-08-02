import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusSelect } from './status-select';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

// Colours are irrelevant to this a11y test; use token var() strings rather than
// raw hex so the file stays clean under `lint:tokens` (which scans test files).
const STATES = [
  { color: 'var(--info)', id: 'todo', name: 'Todo', type: 'unstarted' },
  { color: 'var(--warning)', id: 'doing', name: 'In Progress', type: 'started' },
  { color: 'var(--success)', id: 'done', name: 'Done', type: 'completed' },
];

// §4.2 — the opened panel is a valid ARIA listbox: role="listbox" on the panel,
// role="option" on each item, aria-selected marking the current value.
describe('StatusSelect a11y (listbox pattern)', () => {
  it('exposes the panel as a listbox with option children and marks the selected one', () => {
    render(<StatusSelect forceOpen onChange={() => {}} states={STATES} value="doing" />);

    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(3);

    const selected = options.filter(o => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('In Progress');
  });

  it('marks no option selected when the value matches none', () => {
    render(<StatusSelect forceOpen onChange={() => {}} states={STATES} value="nonexistent" />);
    const options = screen.getAllByRole('option');
    expect(options.every(o => o.getAttribute('aria-selected') === 'false')).toBe(true);
  });
});
