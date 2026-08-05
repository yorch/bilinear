import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProgressBar } from './progress-bar';

function trackAndFill(container: HTMLElement) {
  const track = container.firstElementChild as HTMLElement;
  return { fill: track.firstElementChild as HTMLElement, track };
}

describe('ProgressBar', () => {
  it('drives the fill width from value', () => {
    const { container } = render(<ProgressBar value={42} />);
    expect(trackAndFill(container).fill).toHaveStyle({ width: '42%' });
  });

  // project-detail-view passes `progressStats?.percent ?? 0` while the server
  // progress query is in flight; a 0% fill has to render as an empty bar.
  it('renders an empty bar at 0', () => {
    const { container } = render(<ProgressBar value={0} />);
    expect(trackAndFill(container).fill).toHaveStyle({ width: '0%' });
  });

  it('defaults the fill to the brand token', () => {
    const { container } = render(<ProgressBar value={50} />);
    expect(trackAndFill(container).fill).toHaveClass('bg-brand');
  });

  // sub-issue-list overrides the fill to bg-success. This only works because
  // cn() is twMerge-backed — a plain join would leave both classes on the
  // element and let source order decide the colour.
  it('lets fillClassName replace the brand fill outright', () => {
    const { container } = render(<ProgressBar fillClassName="bg-success" value={50} />);
    const { fill } = trackAndFill(container);
    expect(fill).toHaveClass('bg-success');
    expect(fill).not.toHaveClass('bg-brand');
  });

  it('takes track sizing from className without losing the track styles', () => {
    const { container } = render(<ProgressBar className="h-1.5 w-16" value={50} />);
    const { track } = trackAndFill(container);
    expect(track).toHaveClass('h-1.5', 'w-16', 'overflow-hidden', 'rounded-full', 'bg-muted');
  });
});
