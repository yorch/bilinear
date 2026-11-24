import { beforeEach, describe, expect, it } from 'vitest';
import type { DBDocument } from '@/lib/db';
import { DocumentStore } from './document-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

function makeDocument(overrides: Partial<DBDocument> & { id: string }): DBDocument {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    organizationId: 'org-1',
    sortOrder: 0,
    title: 'Untitled',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('DocumentStore', () => {
  let store: DocumentStore;

  beforeEach(() => {
    store = new DocumentStore();
  });

  runPoolStoreTests<DBDocument>({
    makeRow: makeDocument,
    makeStore: () => new DocumentStore(),
    updateField: 'title',
    updateValue: 'Renamed Doc',
  });

  describe('all', () => {
    it('excludes archived documents', () => {
      store.upsertMany([
        makeDocument({ id: 'd1' }),
        makeDocument({ archivedAt: '2026-03-10T00:00:00Z', id: 'd2' }),
      ]);

      expect(store.all.map(d => d.id)).toEqual(['d1']);
    });

    it('sorts by sortOrder then title', () => {
      store.upsertMany([
        makeDocument({ id: 'd1', sortOrder: 1, title: 'B' }),
        makeDocument({ id: 'd2', sortOrder: 0, title: 'B' }),
        makeDocument({ id: 'd3', sortOrder: 0, title: 'A' }),
      ]);

      expect(store.all.map(d => d.id)).toEqual(['d3', 'd2', 'd1']);
    });
  });

  describe('findById', () => {
    it('returns the document or null', () => {
      store.upsertMany([makeDocument({ id: 'd1' })]);

      expect(store.findById('d1')?.id).toBe('d1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('getByTeamId', () => {
    it('returns root-level docs (no parentId) for the team', () => {
      store.upsertMany([
        makeDocument({ id: 'd1', teamId: 'team-a' }),
        makeDocument({ id: 'd2', parentId: 'd1', teamId: 'team-a' }),
        makeDocument({ id: 'd3', teamId: 'team-b' }),
      ]);

      expect(store.getByTeamId('team-a').map(d => d.id)).toEqual(['d1']);
    });
  });

  describe('getByProjectId', () => {
    it('returns root-level docs (no parentId) for the project', () => {
      store.upsertMany([
        makeDocument({ id: 'd1', projectId: 'proj-a' }),
        makeDocument({ id: 'd2', parentId: 'd1', projectId: 'proj-a' }),
      ]);

      expect(store.getByProjectId('proj-a').map(d => d.id)).toEqual(['d1']);
    });
  });

  describe('getChildren', () => {
    it('returns docs whose parentId matches', () => {
      store.upsertMany([
        makeDocument({ id: 'd1' }),
        makeDocument({ id: 'd2', parentId: 'd1' }),
        makeDocument({ id: 'd3', parentId: 'd1' }),
        makeDocument({ id: 'd4' }),
      ]);

      expect(
        store
          .getChildren('d1')
          .map(d => d.id)
          .sort(),
      ).toEqual(['d2', 'd3']);
    });
  });

  describe('getAncestors / getArchived', () => {
    it('returns the parent chain root-first and survives a cycle', () => {
      store.upsertMany([
        makeDocument({ id: 'a', parentId: 'c' }),
        makeDocument({ id: 'b', parentId: 'a' }),
        makeDocument({ id: 'c', parentId: 'b' }),
      ]);
      expect(store.getAncestors('b').map(d => d.id)).toEqual(['c', 'a']);
      store.upsertMany([
        makeDocument({ id: 'r' }),
        makeDocument({ id: 'm', parentId: 'r' }),
        makeDocument({ id: 'leaf', parentId: 'm' }),
      ]);
      expect(store.getAncestors('leaf').map(d => d.id)).toEqual(['r', 'm']);
    });

    it('lists archived rows in scope, which all/getByProjectId hide', () => {
      store.upsertMany([
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'x', projectId: 'p1' }),
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'y', projectId: 'p2' }),
        makeDocument({ id: 'live', projectId: 'p1' }),
      ]);
      expect(store.getArchived({ projectId: 'p1' }).map(d => d.id)).toEqual(['x']);
      expect(store.getByProjectId('p1').map(d => d.id)).toEqual(['live']);
    });
  });
});
