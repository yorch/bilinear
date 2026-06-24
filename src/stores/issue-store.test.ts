import { beforeEach, describe, expect, it } from 'vitest';
import type { DBIssue } from '@/lib/db';
import { IssueStore } from './issue-store';

function makeIssue(overrides: Partial<DBIssue> & { id: string }): DBIssue {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    identifier: 'ENG-1',
    labelIds: [],
    number: 1,
    organizationId: 'org-1',
    priority: 0,
    prioritySortOrder: 0,
    sortOrder: 0,
    stateId: 'state-todo',
    teamId: 'team-1',
    title: 'An issue',
    trashed: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('IssueStore', () => {
  let store: IssueStore;

  beforeEach(() => {
    store = new IssueStore();
  });

  describe('all', () => {
    it('excludes trashed and archived issues', () => {
      store.upsertMany([
        makeIssue({ id: '1' }),
        makeIssue({ id: '2', trashed: true }),
        makeIssue({ archivedAt: '2026-02-01T00:00:00Z', id: '3' }),
      ]);
      expect(store.all.map(i => i.id)).toEqual(['1']);
    });
  });

  describe('lookups', () => {
    beforeEach(() => {
      store.upsertMany([
        makeIssue({ id: '1', identifier: 'ENG-1', teamId: 'team-1' }),
        makeIssue({ cycleId: 'cyc-1', id: '2', identifier: 'ENG-2', teamId: 'team-1' }),
        makeIssue({ id: '3', identifier: 'DES-1', projectId: 'proj-1', teamId: 'team-2' }),
        makeIssue({ id: '4', identifier: 'ENG-3', teamId: 'team-1', trashed: true }),
      ]);
    });

    it('findById returns the issue or null', () => {
      expect(store.findById('2')?.identifier).toBe('ENG-2');
      expect(store.findById('nope')).toBeNull();
    });

    it('findByIdentifier returns the first exact match', () => {
      expect(store.findByIdentifier('DES-1')?.id).toBe('3');
      expect(store.findByIdentifier('ENG-99')).toBeNull();
    });

    it('findByTeamId excludes trashed/archived', () => {
      expect(store.findByTeamId('team-1').map(i => i.id)).toEqual(['1', '2']);
    });

    it('findByCycleId / findByProjectId / findByStateId scope correctly', () => {
      expect(store.findByCycleId('cyc-1').map(i => i.id)).toEqual(['2']);
      expect(store.findByProjectId('proj-1').map(i => i.id)).toEqual(['3']);
      expect(store.findByStateId('state-todo').map(i => i.id)).toHaveLength(3);
    });
  });

  describe('search', () => {
    beforeEach(() => {
      store.upsertMany([
        makeIssue({ id: '1', identifier: 'ENG-1', title: 'Fix login bug' }),
        makeIssue({ id: '2', identifier: 'ENG-2', title: 'Add dashboard' }),
        makeIssue({ id: '3', identifier: 'ENG-3', title: 'Login redesign', trashed: true }),
      ]);
    });

    it('returns nothing for an empty query', () => {
      expect(store.search('   ')).toEqual([]);
    });

    it('matches on title and excludes trashed', () => {
      const results = store.search('login');
      expect(results.map(i => i.id)).toEqual(['1']);
    });

    it('respects the limit', () => {
      store.upsertMany([
        makeIssue({ id: '10', title: 'task one' }),
        makeIssue({ id: '11', title: 'task two' }),
        makeIssue({ id: '12', title: 'task three' }),
      ]);
      expect(store.search('task', 2)).toHaveLength(2);
    });
  });

  describe('optimisticUpdate', () => {
    it('patches an existing issue', () => {
      store.upsertMany([makeIssue({ id: '1', title: 'Old' })]);
      store.optimisticUpdate('1', { title: 'New' });
      expect(store.findById('1')?.title).toBe('New');
    });

    it('is a no-op for an unknown id', () => {
      store.optimisticUpdate('missing', { title: 'New' });
      expect(store.findById('missing')).toBeNull();
    });
  });

  describe('applySyncAction', () => {
    it('inserts/updates on I/U/A and normalizes labelAssignments', () => {
      const data = {
        ...makeIssue({ id: '1' }),
        labelAssignments: [{ labelId: 'lbl-a' }, { labelId: 'lbl-b' }],
      } as unknown as DBIssue;
      store.applySyncAction('I', '1', data);
      expect(store.findById('1')?.labelIds).toEqual(['lbl-a', 'lbl-b']);
    });

    it('normalizes a GraphQL-style labels array', () => {
      const data = {
        ...makeIssue({ id: '1' }),
        labels: [{ id: 'lbl-x' }],
      } as unknown as DBIssue;
      store.applySyncAction('U', '1', data);
      expect(store.findById('1')?.labelIds).toEqual(['lbl-x']);
    });

    it('falls back to existing labelIds when neither relation shape is present', () => {
      store.applySyncAction('I', '1', makeIssue({ id: '1', labelIds: ['keep'] }));
      expect(store.findById('1')?.labelIds).toEqual(['keep']);
    });

    it('removes a matching optimistic placeholder when a real issue arrives', () => {
      store.upsertMany([
        makeIssue({ id: 'opt', identifier: 'ENG-…', teamId: 'team-1', title: 'New work' }),
      ]);
      store.applySyncAction(
        'I',
        'real',
        makeIssue({ id: 'real', identifier: 'ENG-7', teamId: 'team-1', title: 'New work' }),
      );
      expect(store.findById('opt')).toBeNull();
      expect(store.findById('real')?.identifier).toBe('ENG-7');
    });

    it('does not drop a placeholder with a different title/team', () => {
      store.upsertMany([
        makeIssue({ id: 'opt', identifier: 'ENG-…', teamId: 'team-1', title: 'Other' }),
      ]);
      store.applySyncAction(
        'I',
        'real',
        makeIssue({ id: 'real', identifier: 'ENG-7', teamId: 'team-1', title: 'New work' }),
      );
      expect(store.findById('opt')).not.toBeNull();
    });

    it('deletes on D', () => {
      store.upsertMany([makeIssue({ id: '1' })]);
      store.applySyncAction('D', '1', null);
      expect(store.findById('1')).toBeNull();
    });

    it('ignores I/U/A with null data', () => {
      store.applySyncAction('U', '1', null);
      expect(store.findById('1')).toBeNull();
    });
  });
});
