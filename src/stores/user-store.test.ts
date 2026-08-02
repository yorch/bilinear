import { beforeEach, describe, expect, it } from 'vitest';
import type { DBUser } from '@/lib/db';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';
import { UserStore } from './user-store';

function makeUser(overrides: Partial<DBUser> & { id: string }): DBUser {
  return {
    active: true,
    avatarBgColor: '#6366f1',
    createdAt: '2026-03-01T00:00:00Z',
    displayName: 'Jane Doe',
    email: 'jane@example.com',
    initials: 'JD',
    name: 'Jane Doe',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('UserStore', () => {
  let store: UserStore;

  beforeEach(() => {
    store = new UserStore();
  });

  runPoolStoreTests<DBUser>({
    makeRow: makeUser,
    makeStore: () => new UserStore(),
    updateField: 'displayName',
    updateValue: 'Jane Renamed',
  });

  describe('all', () => {
    it('returns every user in the pool', () => {
      store.upsertMany([makeUser({ id: 'u1' }), makeUser({ id: 'u2' })]);

      expect(store.all.map(u => u.id).sort()).toEqual(['u1', 'u2']);
    });
  });

  describe('findById', () => {
    it('returns the user or null', () => {
      store.upsertMany([makeUser({ id: 'u1' })]);

      expect(store.findById('u1')?.id).toBe('u1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('currentUser / setCurrentUserId', () => {
    it('is null until a current user id is set', () => {
      store.upsertMany([makeUser({ id: 'u1' })]);

      expect(store.currentUser).toBeNull();
    });

    it('resolves the current user once set', () => {
      store.upsertMany([makeUser({ id: 'u1' })]);

      store.setCurrentUserId('u1');

      expect(store.currentUser?.id).toBe('u1');
    });

    it('returns null when the current user id is not (yet) in the pool', () => {
      store.setCurrentUserId('missing');

      expect(store.currentUser).toBeNull();
    });
  });
});
