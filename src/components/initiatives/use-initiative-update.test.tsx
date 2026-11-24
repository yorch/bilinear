import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gqlMutateMock = vi.fn();
vi.mock('@/lib/graphql', () => ({ gqlMutate: gqlMutateMock }));
vi.mock('@/hooks/use-translations', () => ({ useTranslations: () => (key: string) => key }));
const toastErrorMock = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { error: toastErrorMock } }));

const { InitiativeStore } = await import('@/stores/initiative-store');
let store: InstanceType<typeof InitiativeStore>;
vi.mock('@/providers/store-provider', () => ({ useStore: () => ({ initiativeStore: store }) }));

const { useInitiativeUpdate } = await import('./use-initiative-update');

function seed() {
  store = new InitiativeStore();
  store.upsertMany([
    {
      color: '#000',
      createdAt: '2026-01-01T00:00:00Z',
      description: 'old',
      id: 'i1',
      name: 'Growth',
      organizationId: 'o',
      ownerId: 'u1',
      priority: 0,
      prioritySortOrder: 0,
      progress: 0,
      sortOrder: 0,
      status: 'active',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]);
}

describe('useInitiativeUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seed();
  });

  it('applies the patch optimistically and sends it as the mutation input', async () => {
    gqlMutateMock.mockResolvedValue({});
    const { result } = renderHook(() => useInitiativeUpdate());
    await act(async () => {
      await result.current('i1', { ownerId: 'u2', targetDate: '2026-12-01' });
    });
    expect(store.findById('i1')?.ownerId).toBe('u2');
    expect(gqlMutateMock).toHaveBeenCalledWith(expect.any(String), {
      id: 'i1',
      input: { ownerId: 'u2', targetDate: '2026-12-01' },
    });
  });

  it('rolls back only the touched fields and toasts when the server refuses', async () => {
    gqlMutateMock.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useInitiativeUpdate());
    let ok = true;
    await act(async () => {
      ok = await result.current('i1', { description: 'new', parentId: 'i1-bad' });
    });
    expect(ok).toBe(false);
    expect(store.findById('i1')?.description).toBe('old');
    expect(store.findById('i1')?.parentId).toBeUndefined();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });
});
