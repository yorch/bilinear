import { beforeEach, describe, expect, it } from 'vitest';
import type { DBInitiative, DBInitiativeProject } from '@/lib/db';
import { InitiativeStore } from './initiative-store';

function makeInitiative(overrides: Partial<DBInitiative> & { id: string }): DBInitiative {
  return {
    color: '#6366f1',
    createdAt: '2026-01-01T00:00:00Z',
    name: 'Initiative',
    organizationId: 'org-1',
    priority: 0,
    prioritySortOrder: 0,
    progress: 0,
    sortOrder: 0,
    status: 'active',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeLink(
  overrides: Partial<DBInitiativeProject> & { id: string; initiativeId: string; projectId: string },
): DBInitiativeProject {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    sortOrder: 0,
    ...overrides,
  };
}

describe('InitiativeStore', () => {
  let store: InitiativeStore;

  beforeEach(() => {
    store = new InitiativeStore();
  });

  describe('all', () => {
    it('excludes archived and sorts by sortOrder then newest createdAt', () => {
      store.upsertMany([
        makeInitiative({ createdAt: '2026-01-01T00:00:00Z', id: 'a', sortOrder: 0 }),
        makeInitiative({ createdAt: '2026-03-01T00:00:00Z', id: 'b', sortOrder: 0 }),
        makeInitiative({ id: 'c', sortOrder: 1 }),
        makeInitiative({ archivedAt: '2026-02-01T00:00:00Z', id: 'd' }),
      ]);
      expect(store.all.map(i => i.id)).toEqual(['b', 'a', 'c']);
    });
  });

  describe('active / roots / getChildren', () => {
    beforeEach(() => {
      store.upsertMany([
        makeInitiative({ id: 'root', status: 'active' }),
        makeInitiative({ id: 'planned', status: 'planned' }),
        makeInitiative({ id: 'done', status: 'completed' }),
        makeInitiative({ id: 'child', parentId: 'root' }),
      ]);
    });

    it('active includes active + planned only', () => {
      expect(store.active.map(i => i.id).sort()).toEqual(['child', 'planned', 'root']);
    });

    it('roots excludes initiatives with a parent', () => {
      expect(store.roots.map(i => i.id).sort()).toEqual(['done', 'planned', 'root']);
    });

    it('getChildren returns direct children', () => {
      expect(store.getChildren('root').map(i => i.id)).toEqual(['child']);
    });
  });

  describe('project links', () => {
    beforeEach(() => {
      store.upsertMany([
        makeInitiative({ id: 'init-1' }),
        makeInitiative({ id: 'init-2' }),
        makeInitiative({ archivedAt: '2026-02-01T00:00:00Z', id: 'init-archived' }),
      ]);
      store.upsertProjectLinks([
        makeLink({ id: 'l1', initiativeId: 'init-1', projectId: 'proj-b', sortOrder: 1 }),
        makeLink({ id: 'l2', initiativeId: 'init-1', projectId: 'proj-a', sortOrder: 0 }),
        makeLink({ id: 'l3', initiativeId: 'init-2', projectId: 'proj-a', sortOrder: 0 }),
        makeLink({ id: 'l4', initiativeId: 'init-archived', projectId: 'proj-a', sortOrder: 0 }),
      ]);
    });

    it('getProjectIds returns project ids ordered by sortOrder', () => {
      expect(store.getProjectIds('init-1')).toEqual(['proj-a', 'proj-b']);
    });

    it('getInitiativesForProject excludes archived initiatives', () => {
      expect(
        store
          .getInitiativesForProject('proj-a')
          .map(i => i.id)
          .sort(),
      ).toEqual(['init-1', 'init-2']);
    });
  });

  describe('applySyncAction', () => {
    it('upserts on I/U/A', () => {
      store.applySyncAction('I', 'a', makeInitiative({ id: 'a' }));
      expect(store.findById('a')).not.toBeNull();
    });

    it('on D removes the initiative and cascades its project links', () => {
      store.upsertMany([makeInitiative({ id: 'init-1' })]);
      store.upsertProjectLinks([
        makeLink({ id: 'l1', initiativeId: 'init-1', projectId: 'proj-a' }),
        makeLink({ id: 'l2', initiativeId: 'other', projectId: 'proj-a' }),
      ]);
      store.applySyncAction('D', 'init-1', null);
      expect(store.findById('init-1')).toBeNull();
      expect(store.getProjectIds('init-1')).toEqual([]);
      expect(store.getProjectIds('other')).toEqual(['proj-a']);
    });
  });

  describe('applyInitiativeProjectSyncAction', () => {
    it('upserts a link on I/U and deletes on D', () => {
      store.applyInitiativeProjectSyncAction(
        'I',
        'l1',
        makeLink({ id: 'l1', initiativeId: 'init-1', projectId: 'proj-a' }),
      );
      expect(store.getProjectIds('init-1')).toEqual(['proj-a']);
      store.applyInitiativeProjectSyncAction('D', 'l1', null);
      expect(store.getProjectIds('init-1')).toEqual([]);
    });
  });

  describe('optimisticUpdate', () => {
    it('patches an existing initiative and no-ops on unknown id', () => {
      store.upsertMany([makeInitiative({ id: 'a', name: 'Old' })]);
      store.optimisticUpdate('a', { name: 'New' });
      expect(store.findById('a')?.name).toBe('New');
      store.optimisticUpdate('missing', { name: 'X' });
      expect(store.findById('missing')).toBeNull();
    });
  });
});
