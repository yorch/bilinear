import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBCycle } from '@/lib/db';
import { RootStore } from '@/stores/root-store';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/hooks/use-formatters', () => ({
  useFormatters: () => ({ formatDate: () => 'date' }),
}));
const { storeHolder, gqlQuery, gqlMutate, toast, GqlErrorStub } = vi.hoisted(() => {
  class Stub extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    GqlErrorStub: Stub,
    gqlMutate: vi.fn(),
    gqlQuery: vi.fn(),
    storeHolder: {} as { current: RootStore },
    toast: { error: vi.fn(), success: vi.fn(), undo: vi.fn() },
  };
});
vi.mock('@/providers/store-provider', () => ({ useStore: () => storeHolder.current }));
vi.mock('@/lib/graphql', () => ({
  gqlMutate,
  gqlQuery,
  isGqlErrorCode: (err: unknown, ...codes: string[]) =>
    err instanceof GqlErrorStub && !!err.code && codes.includes(err.code),
}));
vi.mock('@/lib/toast', () => ({ toast }));

const { CycleArchivedView } = await import('./cycle-archived-view');

const cycle = (id: string): DBCycle =>
  ({
    archivedAt: '2026-03-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-03-15T00:00:00Z',
    id,
    name: `Cycle ${id}`,
    number: 1,
    organizationId: 'o',
    startsAt: '2026-03-01T00:00:00Z',
    teamId: 't1',
    updatedAt: '2026-01-01T00:00:00Z',
  }) as DBCycle;

describe('CycleArchivedView Restore', () => {
  beforeEach(() => {
    storeHolder.current = new RootStore();
    gqlQuery.mockReset();
    gqlMutate.mockReset();
    toast.error.mockReset();
    gqlQuery.mockResolvedValue([cycle('c1'), cycle('c2')]);
  });
  afterEach(cleanup);

  it('Restore calls the unarchive mutation for that cycle and moves it out of the archive', async () => {
    gqlMutate.mockResolvedValue({});
    render(<CycleArchivedView teamId="t1" />);
    await screen.findByText('Cycle c1');

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /common\.restore/ })[0] as HTMLElement);
    });

    expect(gqlMutate).toHaveBeenCalledTimes(1);
    expect(gqlMutate).toHaveBeenCalledWith(expect.stringContaining('cycleUnarchive'), {
      id: 'c1',
    });
    expect(storeHolder.current.cycleStore.archived.map(c => c.id)).toEqual(['c2']);
  });

  it('disables every Restore while one is in flight, so a second click fires nothing', async () => {
    let resolve: (v: unknown) => void = () => {};
    gqlMutate.mockReturnValue(new Promise(r => (resolve = r)));
    render(<CycleArchivedView teamId="t1" />);
    await screen.findByText('Cycle c2');

    const buttons = screen.getAllByRole('button', { name: /common\.restore/ });
    await act(async () => {
      fireEvent.click(buttons[0] as HTMLElement);
    });
    for (const b of screen.getAllByRole('button', { name: /common\.restore/ })) {
      expect(b).toBeDisabled();
      fireEvent.click(b);
    }
    expect(gqlMutate).toHaveBeenCalledTimes(1);

    await act(async () => resolve({}));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /common\.restore/ })).not.toBeDisabled(),
    );
  });

  it('puts the row back and toasts when the server refuses', async () => {
    gqlMutate.mockRejectedValue(new Error('boom'));
    render(<CycleArchivedView teamId="t1" />);
    await screen.findByText('Cycle c1');

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /common\.restore/ })[0] as HTMLElement);
    });

    expect(toast.error).toHaveBeenCalledWith('boom');
    expect(storeHolder.current.cycleStore.archived).toHaveLength(2);
  });

  it('shows the localized overlap message when the dates were taken', async () => {
    gqlMutate.mockRejectedValue(
      new GqlErrorStub('Cycle dates overlap with an existing cycle', 'BAD_USER_INPUT'),
    );
    render(<CycleArchivedView teamId="t1" />);
    await screen.findByText('Cycle c1');

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /common\.restore/ })[0] as HTMLElement);
    });

    expect(toast.error).toHaveBeenCalledWith('cycles.list.restoreOverlap');
  });
});
