import { beforeEach, describe, expect, it } from 'vitest';
import type { DBTeam } from '@/lib/db';
import { TeamStore } from './team-store';

function makeTeam(overrides: Partial<DBTeam> & { id: string }): DBTeam {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    cyclesEnabled: false,
    displayName: 'Engineering',
    issueCount: 0,
    issueEstimationType: 'notUsed',
    key: 'ENG',
    name: 'Engineering',
    organizationId: 'org-1',
    private: false,
    timezone: 'UTC',
    triageEnabled: false,
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TeamStore', () => {
  let store: TeamStore;

  beforeEach(() => {
    store = new TeamStore();
  });

  it('all excludes archived teams', () => {
    store.upsertMany([
      makeTeam({ id: '1' }),
      makeTeam({ archivedAt: '2026-02-01T00:00:00Z', id: '2' }),
    ]);
    expect(store.all.map(t => t.id)).toEqual(['1']);
  });

  it('findById and findByKey', () => {
    store.upsertMany([makeTeam({ id: '1', key: 'ENG' }), makeTeam({ id: '2', key: 'DES' })]);
    expect(store.findById('2')?.key).toBe('DES');
    expect(store.findByKey('ENG')?.id).toBe('1');
    expect(store.findByKey('NOPE')).toBeNull();
  });

  it('archive (A with archivedAt) keeps the row in the pool but hides it from all', () => {
    store.upsertMany([makeTeam({ id: '1' })]);
    store.applySyncAction('A', '1', makeTeam({ archivedAt: '2026-02-01T00:00:00Z', id: '1' }));
    expect(store.findById('1')).not.toBeNull();
    expect(store.all).toHaveLength(0);
  });

  it('hard delete (D) removes the row', () => {
    store.upsertMany([makeTeam({ id: '1' })]);
    store.applySyncAction('D', '1', null);
    expect(store.findById('1')).toBeNull();
  });
});
