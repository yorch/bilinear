import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColorDot } from './color-dot';

describe('ColorDot', () => {
  // The two sizes are the whole reason StatusDot and LabelDot could merge:
  // workflow states render at 10px, labels at 8px. If the map collapses, the
  // two callers silently converge on one size.
  it('renders workflow-state size at md', () => {
    const { container } = render(<ColorDot color="rgb(255, 0, 0)" size="md" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveClass('h-2.5', 'w-2.5');
    expect(dot).not.toHaveClass('h-2', 'w-2');
  });

  it('renders label size at sm', () => {
    const { container } = render(<ColorDot color="rgb(255, 0, 0)" size="sm" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveClass('h-2', 'w-2');
    expect(dot).not.toHaveClass('h-2.5', 'w-2.5');
  });

  it('defaults to md', () => {
    const { container } = render(<ColorDot color="rgb(255, 0, 0)" />);
    expect(container.firstElementChild).toHaveClass('h-2.5', 'w-2.5');
  });

  // The colour is entity data from the DB (a label/state colour), so it has to
  // stay an inline style — it can never be a design token.
  it('applies the caller colour as an inline background', () => {
    const { container } = render(<ColorDot color="rgb(1, 2, 3)" />);
    expect(container.firstElementChild).toHaveStyle({ backgroundColor: 'rgb(1, 2, 3)' });
  });

  it('lets className win over the size preset', () => {
    const { container } = render(<ColorDot className="h-4 w-4" color="rgb(255, 0, 0)" size="sm" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot).toHaveClass('h-4', 'w-4');
    expect(dot).not.toHaveClass('h-2', 'w-2');
  });
});
