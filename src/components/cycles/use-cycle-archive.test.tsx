import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBCycle } from '@/lib/db';

const gqlMutateMock = vi.fn();
vi.mock('@/lib/graphql', () => ({
  gqlMutate: gqlMutateMock,
  isGqlErrorCode: (err: { code?: string }, ...codes: string[]) =>
    !!err.code && codes.includes(err.code),
}));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (key: string) => key }));
const toastErrorMock = vi.fn();
const toastUndoMock = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { error: toastErrorMock, undo: toastUndoMock } }));

const { CycleStore } = await import('@/stores/cycle-store');
let store: InstanceType<typeof CycleStore>;
vi.mock('@/providers/store-provider', () => ({ useStore: () => ({ cycleStore: store }) }));

const { useCycleArchive } = await import('./use-cycle-archive');

const CYCLE: DBCycle = {
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  endsAt: '2099-01-14T00:00:00Z',
  id: 'c1',
  number: 1,
  organizationId: 'o',
  startsAt: '2098-12-31T00:00:00Z',
  teamId: 't1',
  updatedAt: '2026-01-01T00:00:00Z',
} as DBCycle;

beforeEach(() => {
  gqlMutateMock.mockReset();
  toastErrorMock.mockReset();
  toastUndoMock.mockReset();
  store = new CycleStore();
  store.upsertMany([{ ...CYCLE }]);
});

describe('useCycleArchive', () => {
  it('archives optimistically and offers an undo that restores', async () => {
    gqlMutateMock.mockResolvedValue({});
    const { result } = renderHook(() => useCycleArchive());
    await act(() => result.current.archive(CYCLE));
    expect(store.all).toHaveLength(0);
    expect(store.archived).toHaveLength(1);
    expect(toastUndoMock).toHaveBeenCalledTimes(1);

    await act(async () => toastUndoMock.mock.calls[0][2]());
    expect(gqlMutateMock).toHaveBeenLastCalledWith(expect.stringContaining('cycleUnarchive'), {
      id: 'c1',
    });
    expect(store.all).toHaveLength(1);
    expect(store.archived).toHaveLength(0);
  });

  it('rolls an archive back when the server refuses', async () => {
    gqlMutateMock.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useCycleArchive());
    await act(() => result.current.archive(CYCLE));
    expect(store.all).toHaveLength(1);
    expect(toastErrorMock).toHaveBeenCalled();
    expect(toastUndoMock).not.toHaveBeenCalled();
  });

  it('rolls a restore back when the server refuses', async () => {
    store.optimisticUpdate('c1', { archivedAt: '2026-02-01T00:00:00Z' });
    gqlMutateMock.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useCycleArchive());
    await act(() => result.current.restore(store.findById('c1') as DBCycle));
    expect(store.archived).toHaveLength(1);
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it('ignores a second restore of the same cycle while the first is in flight', async () => {
    store.optimisticUpdate('c1', { archivedAt: '2026-02-01T00:00:00Z' });
    let resolve: (v: unknown) => void = () => {};
    gqlMutateMock.mockReturnValue(new Promise(r => (resolve = r)));
    const { result } = renderHook(() => useCycleArchive());
    const cycle = store.findById('c1') as DBCycle;
    let first: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      first = result.current.restore(cycle);
      expect(await result.current.restore(cycle)).toBe(false);
    });
    expect(gqlMutateMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({});
      await first;
    });
  });

  it('shows localized copy for a restore refused as an overlap', async () => {
    store.optimisticUpdate('c1', { archivedAt: '2026-02-01T00:00:00Z' });
    gqlMutateMock.mockRejectedValue(
      Object.assign(new Error('Cycle dates overlap with an existing cycle'), {
        code: 'BAD_USER_INPUT',
      }),
    );
    const { result } = renderHook(() => useCycleArchive());
    await act(() => result.current.restore(store.findById('c1') as DBCycle));
    expect(toastErrorMock).toHaveBeenCalledWith('cycles.list.restoreOverlap');
    expect(store.archived).toHaveLength(1);
  });
});
