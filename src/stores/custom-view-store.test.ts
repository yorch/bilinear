import { beforeEach, describe, expect, it } from 'vitest';
import type { DBCustomView } from '@/lib/db';
import { CustomViewStore } from './custom-view-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

const TEAM_A = '00000000-0000-0000-0000-000000000100';

function makeCustomView(overrides: Partial<DBCustomView> & { id: string }): DBCustomView {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    creatorId: 'user-1',
    filters: {},
    layout: 'list',
    name: 'My View',
    organizationId: 'org-1',
    shared: false,
    sort: {},
    sortOrder: 0,
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('CustomViewStore', () => {
  let store: CustomViewStore;

  beforeEach(() => {
    store = new CustomViewStore();
  });

  runPoolStoreTests<DBCustomView>({
    makeRow: makeCustomView,
    makeStore: () => new CustomViewStore(),
    updateField: 'name',
    updateValue: 'Renamed View',
  });

  describe('all', () => {
    it('excludes archived views', () => {
      store.upsertMany([
        makeCustomView({ id: 'v1' }),
        makeCustomView({ archivedAt: '2026-03-10T00:00:00Z', id: 'v2' }),
      ]);

      expect(store.all.map(v => v.id)).toEqual(['v1']);
    });

    it('sorts by sortOrder then createdAt desc', () => {
      store.upsertMany([
        makeCustomView({ createdAt: '2026-01-01T00:00:00Z', id: 'v1', sortOrder: 1 }),
        makeCustomView({ createdAt: '2026-02-01T00:00:00Z', id: 'v2', sortOrder: 0 }),
        makeCustomView({ createdAt: '2026-03-01T00:00:00Z', id: 'v3', sortOrder: 0 }),
      ]);

      expect(store.all.map(v => v.id)).toEqual(['v3', 'v2', 'v1']);
    });
  });

  describe('findById', () => {
    it('returns the view or null', () => {
      store.upsertMany([makeCustomView({ id: 'v1' })]);

      expect(store.findById('v1')?.id).toBe('v1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('getByTeamId', () => {
    it('filters by team', () => {
      store.upsertMany([
        makeCustomView({ id: 'v1', teamId: TEAM_A }),
        makeCustomView({ id: 'v2', teamId: 'other-team' }),
      ]);

      expect(store.getByTeamId(TEAM_A).map(v => v.id)).toEqual(['v1']);
    });
  });

  describe('getOrgViews', () => {
    it('returns only views with no teamId', () => {
      store.upsertMany([
        makeCustomView({ id: 'v1', teamId: TEAM_A }),
        makeCustomView({ id: 'v2', teamId: null }),
      ]);

      expect(store.getOrgViews().map(v => v.id)).toEqual(['v2']);
    });
  });
});
