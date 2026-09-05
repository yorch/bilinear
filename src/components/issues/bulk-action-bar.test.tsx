import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BulkActionBar } from './bulk-action-bar';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const base = {
  count: 2,
  labels: [],
  onClear: vi.fn(),
  onUpdate: vi.fn(),
  states: [],
  users: [],
};

describe('BulkActionBar', () => {
  it('reports the checked count and offers Archive only when the page can archive', () => {
    const onArchive = vi.fn();
    const { rerender } = render(<BulkActionBar {...base} onArchive={onArchive} />);
    expect(screen.getByText('issues.selectedCount:{"count":2}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'issues.archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);

    // A page that cannot archive (no handler) must not render a dead button.
    rerender(<BulkActionBar {...base} />);
    expect(screen.queryByRole('button', { name: 'issues.archive' })).toBeNull();
  });

  it('clears the selection through the dedicated control', () => {
    const onClear = vi.fn();
    render(<BulkActionBar {...base} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'issues.clearSelection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
