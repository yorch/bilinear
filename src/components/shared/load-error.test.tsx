import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GqlError } from '@/lib/graphql';
import { LoadError } from './load-error';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

function gqlError(code: string) {
  return new GqlError(`gql ${code}`, code);
}

describe('LoadError', () => {
  it('renders a muted line with no retry for a refused read', () => {
    const onRetry = vi.fn();
    render(
      <LoadError
        cause={gqlError('FORBIDDEN')}
        fallback="Could not load"
        forbiddenMessage="Admins only"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText('Admins only')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a retry affordance for a genuine failure and wires the callback', () => {
    const onRetry = vi.fn();
    render(<LoadError cause={new Error('boom')} fallback="Could not load" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Admins only')).toBeNull();
  });

  it('falls back to the generic text when the refusal has no dedicated message', () => {
    render(
      <LoadError cause={gqlError('UNAUTHENTICATED')} fallback="Could not load" onRetry={vi.fn()} />,
    );
    expect(screen.getByText('Could not load')).toBeInTheDocument();
  });
});
