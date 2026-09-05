import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateCycleModal, defaultCycleRange, isValidCycleRange } from './create-cycle-modal';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

const { gqlMutate } = vi.hoisted(() => ({ gqlMutate: vi.fn() }));
vi.mock('@/lib/graphql', () => ({ gqlMutate }));

// jsdom does not implement <dialog>'s showModal/close (see
// global-create-issue-modal.test.tsx for the same stub).
HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});
HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

beforeEach(() => {
  gqlMutate.mockReset();
});

describe('cycle range helpers', () => {
  it('defaults to a range of N weeks starting today', () => {
    const { end, start } = defaultCycleRange(2, new Date(2026, 0, 5));
    expect(start).toBe('2026-01-05');
    expect(end).toBe('2026-01-18');
  });

  it('accepts a same-day range and rejects a reversed one', () => {
    expect(isValidCycleRange('2026-01-05', '2026-01-05')).toBe(true);
    expect(isValidCycleRange('2026-01-05', '2026-01-04')).toBe(false);
    expect(isValidCycleRange('', '2026-01-04')).toBe(false);
  });
});

describe('CreateCycleModal', () => {
  it('blocks submit and shows the hint while the range is reversed', () => {
    render(<CreateCycleModal onClose={() => {}} onCreated={() => {}} open teamId="team-1" />);
    fireEvent.change(screen.getByLabelText('cycles.create.startDate'), {
      target: { value: '2026-03-10' },
    });
    fireEvent.change(screen.getByLabelText('cycles.create.endDate'), {
      target: { value: '2026-03-01' },
    });
    expect(screen.getByText('cycles.create.invalidRange')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'cycles.create.submit' })).toBeDisabled();
  });

  it('submits ISO timestamps for the team and hands the new cycle back', async () => {
    const created = { id: 'c1', number: 1, teamId: 'team-1' };
    gqlMutate.mockResolvedValueOnce({ cycleCreate: { cycle: created, success: true } });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreateCycleModal onClose={onClose} onCreated={onCreated} open teamId="team-1" />);

    fireEvent.change(screen.getByLabelText(/cycles.create.name/), {
      target: { value: 'Sprint 1' },
    });
    fireEvent.change(screen.getByLabelText('cycles.create.startDate'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByLabelText('cycles.create.endDate'), {
      target: { value: '2026-03-14' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'cycles.create.submit' }));

    await waitFor(() => expect(gqlMutate).toHaveBeenCalledTimes(1));
    const input = gqlMutate.mock.calls[0][1].input as Record<string, unknown>;
    expect(input.teamId).toBe('team-1');
    expect(input.name).toBe('Sprint 1');
    expect(new Date(input.startsAt as string).getTime()).toBeLessThan(
      new Date(input.endsAt as string).getTime(),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalled();
  });

  it('surfaces a rejected create inline instead of closing', async () => {
    gqlMutate.mockRejectedValueOnce(new Error('overlaps an existing cycle'));
    const onClose = vi.fn();
    render(<CreateCycleModal onClose={onClose} onCreated={() => {}} open teamId="team-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'cycles.create.submit' }));
    await waitFor(() => expect(screen.getByText('overlaps an existing cycle')).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });
});
