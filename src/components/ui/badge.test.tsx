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

  it('applies the solid variant classes', () => {
    render(<Badge variant="solid">Solid</Badge>);
    const badge = screen.getByText('Solid');
    expect(badge).toHaveClass('rounded');
    expect(badge).toHaveClass('text-white');
    expect(badge).not.toHaveClass('rounded-full');
  });

  it('merges a custom className with the variant classes', () => {
    render(
      <Badge className="bg-red-500" variant="solid">
        Custom
      </Badge>,
    );
    const badge = screen.getByText('Custom');
    expect(badge).toHaveClass('bg-red-500');
    expect(badge).toHaveClass('text-white');
  });

  it('forwards arbitrary span props', () => {
    render(<Badge data-testid="my-badge">Props</Badge>);
    expect(screen.getByTestId('my-badge')).toBeInTheDocument();
  });
});
