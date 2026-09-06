import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the glyph tile and full padding by default', () => {
    render(<EmptyState icon={<svg aria-hidden="true" data-testid="glyph" />} title="Nothing" />);
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
    expect(screen.getByText('Nothing').parentElement).toHaveClass('py-14');
  });

  // The compact variant is the dashed inset that sub-sections and settings
  // lists used to hand-roll. It drops the glyph tile — inside a card it would
  // dwarf the rows around it — and takes the dashed frame instead.
  it('renders compact as a dashed inset without the glyph tile', () => {
    render(
      <EmptyState
        icon={<svg aria-hidden="true" data-testid="glyph" />}
        size="compact"
        testId="empty"
        title="No entries"
      />,
    );
    expect(screen.queryByTestId('glyph')).not.toBeInTheDocument();
    const root = screen.getByTestId('empty');
    expect(root).toHaveClass('border-dashed');
    expect(root).not.toHaveClass('py-14');
    expect(screen.getByText('No entries')).toBeInTheDocument();
  });
});
