import { beforeEach, describe, expect, it } from 'vitest';
import type { DBFavorite } from '@/lib/db';
import { FavoriteStore } from './favorite-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

function makeFavorite(overrides: Partial<DBFavorite> & { id: string }): DBFavorite {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    entityId: 'entity-1',
    entityType: 'Issue',
    organizationId: 'org-1',
    sortOrder: 0,
    userId: 'user-1',
    ...overrides,
  };
}

describe('FavoriteStore', () => {
  let store: FavoriteStore;

  beforeEach(() => {
    store = new FavoriteStore();
  });

  runPoolStoreTests<DBFavorite>({
    makeRow: makeFavorite,
    makeStore: () => new FavoriteStore(),
    updateField: 'sortOrder',
    updateValue: 5,
  });

  describe('all', () => {
    it('sorts by sortOrder', () => {
      store.upsertMany([
        makeFavorite({ id: 'f1', sortOrder: 2 }),
        makeFavorite({ id: 'f2', sortOrder: 0 }),
        makeFavorite({ id: 'f3', sortOrder: 1 }),
      ]);

      expect(store.all.map(f => f.id)).toEqual(['f2', 'f3', 'f1']);
    });
  });

  describe('findById', () => {
    it('returns the favorite or null', () => {
      store.upsertMany([makeFavorite({ id: 'f1' })]);

      expect(store.findById('f1')?.id).toBe('f1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('getByEntityId', () => {
    it('returns the favorite referencing the given entity', () => {
      store.upsertMany([
        makeFavorite({ entityId: 'issue-1', id: 'f1' }),
        makeFavorite({ entityId: 'issue-2', id: 'f2' }),
      ]);

      expect(store.getByEntityId('issue-2')?.id).toBe('f2');
      expect(store.getByEntityId('issue-nope')).toBeNull();
    });
  });
});
