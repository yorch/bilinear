import { beforeEach, describe, expect, it } from 'vitest';
import type { DBIssueRelation } from '@/lib/db';
import { IssueRelationStore } from './issue-relation-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

function makeRelation(overrides: Partial<DBIssueRelation> & { id: string }): DBIssueRelation {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    issueId: 'issue-1',
    relatedIssueId: 'issue-2',
    type: 'related',
    ...overrides,
  };
}

describe('IssueRelationStore', () => {
  let store: IssueRelationStore;

  beforeEach(() => {
    store = new IssueRelationStore();
  });

  runPoolStoreTests<DBIssueRelation>({
    makeRow: makeRelation,
    makeStore: () => new IssueRelationStore(),
    updateField: 'type',
    updateValue: 'blocks',
  });

  describe('all', () => {
    it('sorts by createdAt asc', () => {
      store.upsertMany([
        makeRelation({ createdAt: '2026-03-03T00:00:00Z', id: 'r1' }),
        makeRelation({ createdAt: '2026-03-01T00:00:00Z', id: 'r2' }),
        makeRelation({ createdAt: '2026-03-02T00:00:00Z', id: 'r3' }),
      ]);

      expect(store.all.map(r => r.id)).toEqual(['r2', 'r3', 'r1']);
    });
  });

  describe('findById', () => {
    it('returns the relation or null', () => {
      store.upsertMany([makeRelation({ id: 'r1' })]);

      expect(store.findById('r1')?.id).toBe('r1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('findByIssueId', () => {
    it('matches either side of the relation', () => {
      store.upsertMany([
        makeRelation({ id: 'r1', issueId: 'issue-a', relatedIssueId: 'issue-b' }),
        makeRelation({ id: 'r2', issueId: 'issue-c', relatedIssueId: 'issue-a' }),
        makeRelation({ id: 'r3', issueId: 'issue-d', relatedIssueId: 'issue-e' }),
      ]);

      expect(
        store
          .findByIssueId('issue-a')
          .map(r => r.id)
          .sort(),
      ).toEqual(['r1', 'r2']);
    });
  });

  describe('optimisticUpdate', () => {
    it('patches an existing relation', () => {
      store.upsertMany([makeRelation({ id: 'r1', type: 'related' })]);

      store.optimisticUpdate('r1', { type: 'duplicate' });

      expect(store.pool.get('r1')?.type).toBe('duplicate');
    });

    it('does nothing for a non-existent relation', () => {
      store.optimisticUpdate('nope', { type: 'duplicate' });

      expect(store.pool.size).toBe(0);
    });
  });
});
