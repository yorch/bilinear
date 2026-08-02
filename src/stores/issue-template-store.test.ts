import { beforeEach, describe, expect, it } from 'vitest';
import type { DBIssueTemplate } from '@/lib/db';
import { IssueTemplateStore } from './issue-template-store';
import { runPoolStoreTests } from './test-helpers/pool-store-tests';

function makeTemplate(overrides: Partial<DBIssueTemplate> & { id: string }): DBIssueTemplate {
  return {
    createdAt: '2026-03-01T00:00:00Z',
    isDefault: false,
    name: 'Bug Report',
    teamId: 'team-a',
    templateData: {},
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

describe('IssueTemplateStore', () => {
  let store: IssueTemplateStore;

  beforeEach(() => {
    store = new IssueTemplateStore();
  });

  runPoolStoreTests<DBIssueTemplate>({
    makeRow: makeTemplate,
    makeStore: () => new IssueTemplateStore(),
    updateField: 'name',
    updateValue: 'Renamed Template',
  });

  describe('all', () => {
    it('excludes archived templates', () => {
      store.upsertMany([
        makeTemplate({ id: 't1' }),
        makeTemplate({ archivedAt: '2026-03-10T00:00:00Z', id: 't2' }),
      ]);

      expect(store.all.map(t => t.id)).toEqual(['t1']);
    });

    it('sorts the default template first, then the rest by name', () => {
      store.upsertMany([
        makeTemplate({ id: 't1', isDefault: true, name: 'A Default' }),
        makeTemplate({ id: 't2', isDefault: false, name: 'B' }),
        makeTemplate({ id: 't3', isDefault: false, name: 'A' }),
      ]);

      expect(store.all.map(t => t.id)).toEqual(['t1', 't3', 't2']);
    });
  });

  describe('findById', () => {
    it('returns the template or null', () => {
      store.upsertMany([makeTemplate({ id: 't1' })]);

      expect(store.findById('t1')?.id).toBe('t1');
      expect(store.findById('nope')).toBeNull();
    });
  });

  describe('findByTeamId', () => {
    it('filters by team', () => {
      store.upsertMany([
        makeTemplate({ id: 't1', teamId: 'team-a' }),
        makeTemplate({ id: 't2', teamId: 'team-b' }),
      ]);

      expect(store.findByTeamId('team-a').map(t => t.id)).toEqual(['t1']);
    });
  });

  describe('getDefaultForTeam', () => {
    it('returns the default template for the team', () => {
      store.upsertMany([
        makeTemplate({ id: 't1', isDefault: false, teamId: 'team-a' }),
        makeTemplate({ id: 't2', isDefault: true, teamId: 'team-a' }),
      ]);

      expect(store.getDefaultForTeam('team-a')?.id).toBe('t2');
    });

    it('returns null when no default exists', () => {
      store.upsertMany([makeTemplate({ id: 't1', isDefault: false, teamId: 'team-a' })]);

      expect(store.getDefaultForTeam('team-a')).toBeNull();
    });
  });

  describe('optimisticUpdate', () => {
    it('patches an existing template', () => {
      store.upsertMany([makeTemplate({ id: 't1', name: 'Bug Report' })]);

      store.optimisticUpdate('t1', { name: 'Patched' });

      expect(store.pool.get('t1')?.name).toBe('Patched');
    });

    it('does nothing for a non-existent template', () => {
      store.optimisticUpdate('nope', { name: 'Patched' });

      expect(store.pool.size).toBe(0);
    });
  });
});
