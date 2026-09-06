import { act, fireEvent, render, screen } from '@testing-library/react';
import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootStore } from '@/stores/root-store';
import { FavoriteToggle } from './favorite-toggle';

vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));

const { storeHolder, gqlMutate, toastSuccess, toastError } = vi.hoisted(() => ({
  gqlMutate: vi.fn(),
  storeHolder: {} as { current: RootStore },
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => storeHolder.current,
}));
vi.mock('@/lib/graphql', () => ({ gqlMutate }));
vi.mock('@/lib/toast', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

const favoriteRow = {
  createdAt: '2026-09-01T00:00:00Z',
  entityId: 'proj-1',
  entityType: 'Project',
  id: 'fav-1',
  organizationId: 'org',
  sortOrder: 0,
  userId: 'u1',
};

beforeEach(() => {
  storeHolder.current = new RootStore();
  gqlMutate.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe('FavoriteToggle', () => {
  it('creates a favorite and pins it in the store from the mutation payload', async () => {
    gqlMutate.mockResolvedValueOnce({ favoriteCreate: { favorite: favoriteRow, success: true } });
    render(<FavoriteToggle entityId="proj-1" entityType="Project" />);

    const button = screen.getByRole('button', { name: 'favorites.addToFavorites' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(gqlMutate).toHaveBeenCalledTimes(1);
    const [, variables] = gqlMutate.mock.calls[0] as [string, { input: unknown }];
    expect(variables.input).toEqual({ entityId: 'proj-1', entityType: 'Project' });
    expect(storeHolder.current.favoriteStore.getByEntityId('proj-1')?.id).toBe('fav-1');
    expect(toastSuccess).toHaveBeenCalledWith('favorites.added');
    expect(screen.getByRole('button', { name: 'nav.removeFromFavorites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('removes an existing favorite through favoriteDelete', async () => {
    runInAction(() => {
      storeHolder.current.favoriteStore.applySyncAction('I', 'fav-1', favoriteRow);
    });
    gqlMutate.mockResolvedValueOnce({ favoriteDelete: { success: true } });
    render(<FavoriteToggle entityId="proj-1" entityType="Project" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'nav.removeFromFavorites' }));
    });

    const [, variables] = gqlMutate.mock.calls[0] as [string, { id: string }];
    expect(variables).toEqual({ id: 'fav-1' });
    expect(storeHolder.current.favoriteStore.getByEntityId('proj-1')).toBeNull();
    expect(toastSuccess).toHaveBeenCalledWith('favorites.removed');
  });

  it('leaves the store untouched and toasts when the mutation fails', async () => {
    gqlMutate.mockRejectedValueOnce(new Error('nope'));
    render(<FavoriteToggle entityId="proj-1" entityType="Project" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'favorites.addToFavorites' }));
    });
    expect(storeHolder.current.favoriteStore.getByEntityId('proj-1')).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
