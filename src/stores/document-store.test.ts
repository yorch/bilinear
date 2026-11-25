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

  describe('orphans are roots', () => {
    it('lists a child whose parent is archived, missing or in a cycle', () => {
      store.upsertMany([
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'dead', teamId: 'team-a' }),
        makeDocument({ id: 'under-archived', parentId: 'dead', teamId: 'team-a' }),
        makeDocument({ id: 'under-missing', parentId: 'gone', teamId: 'team-a' }),
        makeDocument({ id: 'c1', parentId: 'c2', teamId: 'team-a' }),
        makeDocument({ id: 'c2', parentId: 'c1', teamId: 'team-a' }),
        makeDocument({ id: 'top', teamId: 'team-a' }),
        makeDocument({ id: 'nested', parentId: 'top', teamId: 'team-a' }),
      ]);
      const roots = store
        .getByTeamId('team-a')
        .map(d => d.id)
        .sort();
      expect(roots).toEqual(['c1', 'c2', 'top', 'under-archived', 'under-missing']);
      expect(
        store
          .getRoots()
          .map(d => d.id)
          .sort(),
      ).toEqual(roots);
    });

    it('scopes project roots the same way', () => {
      store.upsertMany([makeDocument({ id: 'o', parentId: 'gone', projectId: 'p1' })]);
      expect(store.getByProjectId('p1').map(d => d.id)).toEqual(['o']);
    });

    it('a restored child nests again once its parent is live', () => {
      store.upsertMany([
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'p', teamId: 't' }),
        makeDocument({ id: 'k', parentId: 'p', teamId: 't' }),
      ]);
      expect(store.getByTeamId('t').map(d => d.id)).toEqual(['k']);
      store.optimisticUpdate('p', { archivedAt: null });
      expect(store.getByTeamId('t').map(d => d.id)).toEqual(['p']);
    });
  });

  describe('getArchived ordering and scope', () => {
    it('sorts most recently archived first', () => {
      store.upsertMany([
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'old' }),
        makeDocument({ archivedAt: '2026-06-01T00:00:00Z', id: 'new' }),
        makeDocument({ archivedAt: '2026-05-01T00:00:00Z', id: 'mid' }),
      ]);
      expect(store.getArchived({}).map(d => d.id)).toEqual(['new', 'mid', 'old']);
    });

    it('scopes by team', () => {
      store.upsertMany([
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'a', teamId: 'team-a' }),
        makeDocument({ archivedAt: '2026-04-01T00:00:00Z', id: 'b', teamId: 'team-b' }),
      ]);
      expect(store.getArchived({ teamId: 'team-a' }).map(d => d.id)).toEqual(['a']);
    });
  });

  describe('optimisticUpdate', () => {
    it('patches the pooled row and ignores unknown ids', () => {
      store.upsertMany([makeDocument({ id: 'd1', title: 'Before' })]);
      store.optimisticUpdate('d1', { title: 'After' });
      store.optimisticUpdate('ghost', { title: 'x' });
      expect(store.findById('d1')?.title).toBe('After');
      expect(store.pool.has('ghost')).toBe(false);
    });
  });
});
