import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl } from './segmented-control';

const OPTIONS = [
  { label: 'Issues', value: 'issues' },
  { label: 'Points', value: 'points' },
];

describe('SegmentedControl', () => {
  it('renders every option', () => {
    render(<SegmentedControl onChange={() => {}} options={OPTIONS} value="issues" />);
    expect(screen.getByRole('button', { name: 'Issues' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Points' })).toBeInTheDocument();
  });

  // The selected segment is the only affordance telling you which range or
  // metric the chart below is showing.
  it('marks only the selected segment', () => {
    render(<SegmentedControl onChange={() => {}} options={OPTIONS} value="points" />);
    expect(screen.getByRole('button', { name: 'Points' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Issues' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('styles the selected segment as a filled pill', () => {
    render(<SegmentedControl onChange={() => {}} options={OPTIONS} value="points" />);
    expect(screen.getByRole('button', { name: 'Points' })).toHaveClass('bg-muted');
    expect(screen.getByRole('button', { name: 'Issues' })).not.toHaveClass('bg-muted');
  });

  it('reports the clicked value', () => {
    const onChange = vi.fn();
    render(<SegmentedControl onChange={onChange} options={OPTIONS} value="issues" />);
    fireEvent.click(screen.getByRole('button', { name: 'Points' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('points');
  });

  // insights-section renders localized labels over internal preset ids
  // ('30d' must never reach the screen), so label and value must stay distinct.
  it('renders the label, not the value', () => {
    render(
      <SegmentedControl
        onChange={() => {}}
        options={[{ label: 'Last 30 days', value: '30d' }]}
        value="30d"
      />,
    );
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toBeInTheDocument();
    expect(screen.queryByText('30d')).not.toBeInTheDocument();
  });
});
