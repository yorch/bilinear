import { beforeEach, describe, expect, it } from 'vitest';
import type { DBWorkflowState } from '@/lib/db';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';
import { WorkflowStateStore } from './workflow-state-store';

function makeState(overrides: Partial<DBWorkflowState> & { id: string }): DBWorkflowState {
  return {
    color: '#6366f1',
    createdAt: '2026-03-01T00:00:00Z',
    name: 'Todo',
    position: 0,
    teamId: 'team-a',
    type: 'unstarted',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('WorkflowStateStore', () => {
  let store: WorkflowStateStore;

  beforeEach(() => {
    store = new WorkflowStateStore();
  });

  runPoolStoreTests<DBWorkflowState>({
    makeRow: makeState,
    makeStore: () => new WorkflowStateStore(),
    updateField: 'name',
    updateValue: 'In Progress',
  });

  describe('all', () => {
    it('excludes archived states', () => {
      store.upsertMany([
        makeState({ id: 's1' }),
        makeState({ archivedAt: '2026-03-10T00:00:00Z', id: 's2' }),
      ]);

      expect(store.all.map(s => s.id)).toEqual(['s1']);
    });
  });

  describe('findById', () => {
    it('returns the state or null', () => {
      store.upsertMany([makeState({ id: 's1' })]);

      expect(store.findById('s1')?.id).toBe('s1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('findByTeamId', () => {
    it('filters by team, excludes archived, and sorts by position', () => {
      store.upsertMany([
        makeState({ id: 's1', position: 2, teamId: 'team-a' }),
        makeState({ id: 's2', position: 0, teamId: 'team-a' }),
        makeState({ id: 's3', position: 1, teamId: 'team-a' }),
        makeState({ id: 's4', position: 0, teamId: 'team-b' }),
        makeState({
          archivedAt: '2026-03-10T00:00:00Z',
          id: 's5',
          position: -1,
          teamId: 'team-a',
        }),
      ]);

      expect(store.findByTeamId('team-a').map(s => s.id)).toEqual(['s2', 's3', 's1']);
    });
  });
});
