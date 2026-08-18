import { beforeEach, describe, expect, it } from 'vitest';
import type { DBProject, DBProjectMilestone, DBProjectUpdate } from '@/lib/db';
import { ProjectStore } from './project-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT_A = 'proj-a';
const PROJECT_B = 'proj-b';
const USER_1 = 'user-1';
const USER_2 = 'user-2';

function makeUpdate(overrides: Partial<DBProjectUpdate> & { id: string }): DBProjectUpdate {
  return {
    body: 'All good',
    createdAt: '2026-01-01T00:00:00Z',
    editedAt: null,
    health: null,
    projectId: PROJECT_A,
    updatedAt: '2026-01-01T00:00:00Z',
    userId: USER_1,
    ...overrides,
  };
}

function makeProject(overrides: Partial<DBProject> & { id: string }): DBProject {
  return {
    color: '#000000',
    createdAt: '2026-01-01T00:00:00Z',
    description: '',
    name: 'Project',
    organizationId: 'org-1',
    priority: 0,
    prioritySortOrder: 0,
    roadmapVisible: true,
    slugId: 'slug',
    statusType: 'planned',
    trashed: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMilestone(
  overrides: Partial<DBProjectMilestone> & { id: string },
): DBProjectMilestone {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    name: 'Milestone',
    projectId: PROJECT_A,
    sortOrder: 0,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProjectStore', () => {
  let store: ProjectStore;

  beforeEach(() => {
    store = new ProjectStore();
  });

  // ─── upsertUpdates ──────────────────────────────────────────────────────────

  describe('upsertUpdates', () => {
    it('inserts new updates into the pool', () => {
      const u1 = makeUpdate({ id: 'u1' });
      const u2 = makeUpdate({ id: 'u2', projectId: PROJECT_B });

      store.upsertUpdates([u1, u2]);

      expect(store.updatePool.size).toBe(2);
      expect(store.updatePool.get('u1')).toEqual(u1);
      expect(store.updatePool.get('u2')).toEqual(u2);
    });

    it('overwrites an existing update on re-upsert', () => {
      store.upsertUpdates([makeUpdate({ body: 'original', id: 'u1' })]);
      store.upsertUpdates([makeUpdate({ body: 'updated', id: 'u1' })]);

      expect(store.updatePool.get('u1')?.body).toBe('updated');
      expect(store.updatePool.size).toBe(1);
    });

    it('handles an empty array without error', () => {
      store.upsertUpdates([]);
      expect(store.updatePool.size).toBe(0);
    });
  });

  // ─── getUpdates ─────────────────────────────────────────────────────────────

  describe('getUpdates', () => {
    it('returns only updates belonging to the given projectId', () => {
      store.upsertUpdates([
        makeUpdate({ id: 'u1', projectId: PROJECT_A }),
        makeUpdate({ id: 'u2', projectId: PROJECT_B }),
        makeUpdate({ id: 'u3', projectId: PROJECT_A }),
      ]);

      const result = store.getUpdates(PROJECT_A);
      expect(result).toHaveLength(2);
      expect(result.every(u => u.projectId === PROJECT_A)).toBe(true);
    });

    it('returns updates sorted newest first by createdAt', () => {
      store.upsertUpdates([
        makeUpdate({ createdAt: '2026-01-01T00:00:00Z', id: 'u1' }),
        makeUpdate({ createdAt: '2026-01-03T00:00:00Z', id: 'u3' }),
        makeUpdate({ createdAt: '2026-01-02T00:00:00Z', id: 'u2' }),
      ]);

      const ids = store.getUpdates(PROJECT_A).map(u => u.id);
      expect(ids).toEqual(['u3', 'u2', 'u1']);
    });

    it('returns an empty array when the project has no updates', () => {
      store.upsertUpdates([makeUpdate({ id: 'u1', projectId: PROJECT_B })]);

      expect(store.getUpdates(PROJECT_A)).toHaveLength(0);
    });

    it('returns an empty array when the pool is empty', () => {
      expect(store.getUpdates(PROJECT_A)).toHaveLength(0);
    });

    it('includes updates from multiple users', () => {
      store.upsertUpdates([
        makeUpdate({ id: 'u1', userId: USER_1 }),
        makeUpdate({ id: 'u2', userId: USER_2 }),
      ]);

      const result = store.getUpdates(PROJECT_A);
      expect(result).toHaveLength(2);
    });
  });

  // ─── applyUpdateSyncAction ──────────────────────────────────────────────────

  describe('applyUpdateSyncAction', () => {
    it('inserts a new update on action I', () => {
      const u = makeUpdate({ id: 'u1' });
      store.applyUpdateSyncAction('I', 'u1', u);

      expect(store.updatePool.get('u1')).toEqual(u);
    });

    it('replaces an existing update on action U', () => {
      store.upsertUpdates([makeUpdate({ body: 'original', id: 'u1' })]);
      store.applyUpdateSyncAction('U', 'u1', makeUpdate({ body: 'revised', id: 'u1' }));

      expect(store.updatePool.get('u1')?.body).toBe('revised');
    });

    it('upserts on action A (archive passthrough)', () => {
      const u = makeUpdate({ id: 'u1' });
      store.applyUpdateSyncAction('A', 'u1', u);

      expect(store.updatePool.get('u1')).toEqual(u);
    });

    it('removes the update from the pool on action D', () => {
      store.upsertUpdates([makeUpdate({ id: 'u1' })]);
      store.applyUpdateSyncAction('D', 'u1', null);

      expect(store.updatePool.has('u1')).toBe(false);
    });

    it('does not add anything on action D for a non-existent id', () => {
      store.applyUpdateSyncAction('D', 'ghost-id', null);
      expect(store.updatePool.size).toBe(0);
    });

    it('ignores null data on insert/update actions', () => {
      store.applyUpdateSyncAction('I', 'u1', null);
      expect(store.updatePool.has('u1')).toBe(false);
    });
  });

  // ProjectStore is the only three-pool store, so each dispatcher is asserted to
  // touch its own pool AND to leave the other two alone — that cross-pool check
  // is what actually pins the delegation target. A copy-paste that pointed
  // `applyMilestoneSyncAction` at `this.pool` would still pass a single-pool test.
  describe('pool dispatchers write to the right pool', () => {
    it('applySyncAction touches only the project pool', () => {
      store.applySyncAction('I', 'p1', makeProject({ id: 'p1' }));

      expect(store.pool.has('p1')).toBe(true);
      expect(store.milestonePool.size).toBe(0);
      expect(store.updatePool.size).toBe(0);
    });

    it('applyMilestoneSyncAction touches only the milestone pool', () => {
      store.applyMilestoneSyncAction('I', 'm1', makeMilestone({ id: 'm1' }));

      expect(store.milestonePool.has('m1')).toBe(true);
      expect(store.pool.size).toBe(0);
      expect(store.updatePool.size).toBe(0);
    });

    it('applyMilestoneSyncAction upserts on U/A and deletes on D', () => {
      store.applyMilestoneSyncAction('I', 'm1', makeMilestone({ id: 'm1' }));
      store.applyMilestoneSyncAction('U', 'm1', makeMilestone({ id: 'm1', name: 'Renamed' }));
      expect(store.milestonePool.get('m1')?.name).toBe('Renamed');

      store.applyMilestoneSyncAction('A', 'm1', makeMilestone({ id: 'm1', name: 'Archived' }));
      expect(store.milestonePool.get('m1')?.name).toBe('Archived');

      store.applyMilestoneSyncAction('D', 'm1', null);
      expect(store.milestonePool.has('m1')).toBe(false);
    });
  });
});

// The shared SyncAction contract, applied to the project pool itself.
describe('ProjectStore (project pool)', () => {
  runPoolStoreTests<DBProject>({
    makeRow: makeProject,
    makeStore: () => new ProjectStore(),
    updateField: 'name',
    updateValue: 'Renamed',
  });
});
