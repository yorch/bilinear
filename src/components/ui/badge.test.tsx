import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>In Progress</Badge>);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });

  it('defaults to the pill variant', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toHaveClass('rounded-full');
    expect(badge).not.toHaveClass('text-white');
  });

  it('applies the pill variant classes explicitly', () => {
    render(<Badge variant="pill">Pill</Badge>);
    const badge = screen.getByText('Pill');
    expect(badge).toHaveClass('rounded-full');
    expect(badge).toHaveClass('px-2');
  });

  it('applies the square variant classes', () => {
    render(<Badge variant="square">Square</Badge>);
    const badge = screen.getByText('Square');
    expect(badge).toHaveClass('rounded');
    expect(badge).not.toHaveClass('rounded-full');
  });

  // No variant may hardcode an ink colour: white over a caller-supplied vivid
  // fill is how the health badges ended up at ~1.4:1 in dark mode.
  it('never forces a text colour', () => {
    for (const variant of ['pill', 'square'] as const) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).not.toHaveClass('text-white');
      unmount();
    }
  });

  it('pairs a fill with its own ink for every tone', () => {
    render(<Badge tone="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge).toHaveClass('bg-warning-subtle');
    expect(badge).toHaveClass('text-warning-subtle-foreground');
  });

  it('merges a custom className with the variant classes', () => {
    render(
      <Badge className="bg-danger-subtle" variant="square">
        Custom
      </Badge>,
    );
    const badge = screen.getByText('Custom');
    expect(badge).toHaveClass('bg-danger-subtle');
    expect(badge).toHaveClass('rounded');
  });

  it('forwards arbitrary span props', () => {
    render(<Badge data-testid="my-badge">Props</Badge>);
    expect(screen.getByTestId('my-badge')).toBeInTheDocument();
  });
});
