import { beforeEach, describe, expect, it } from 'vitest';
import type { DBIssueLabel } from '@/lib/db';
import { LabelStore } from './label-store';

function makeLabel(overrides: Partial<DBIssueLabel> & { id: string }): DBIssueLabel {
  return {
    color: '#ef4444',
    createdAt: '2026-01-01T00:00:00Z',
    isGroup: false,
    name: 'Bug',
    organizationId: 'org-1',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('LabelStore', () => {
  let store: LabelStore;

  beforeEach(() => {
    store = new LabelStore();
  });

  it('all excludes archived labels', () => {
    store.upsertMany([
      makeLabel({ id: '1' }),
      makeLabel({ archivedAt: '2026-02-01T00:00:00Z', id: '2' }),
    ]);
    expect(store.all.map(l => l.id)).toEqual(['1']);
  });

  it('findByOrgId scopes by org and excludes archived', () => {
    store.upsertMany([
      makeLabel({ id: '1', organizationId: 'org-1' }),
      makeLabel({ id: '2', organizationId: 'org-2' }),
      makeLabel({ archivedAt: '2026-02-01T00:00:00Z', id: '3', organizationId: 'org-1' }),
    ]);
    expect(store.findByOrgId('org-1').map(l => l.id)).toEqual(['1']);
  });

  it('findById returns the label or null', () => {
    store.upsertMany([makeLabel({ id: '1' })]);
    expect(store.findById('1')?.name).toBe('Bug');
    expect(store.findById('nope')).toBeNull();
  });

  it('archive keeps the label in the pool so issue references still resolve', () => {
    store.upsertMany([makeLabel({ id: '1' })]);
    store.applySyncAction('A', '1', makeLabel({ archivedAt: '2026-02-01T00:00:00Z', id: '1' }));
    expect(store.findById('1')).not.toBeNull();
    expect(store.all).toHaveLength(0);
  });

  it('hard delete (D) removes the label', () => {
    store.upsertMany([makeLabel({ id: '1' })]);
    store.applySyncAction('D', '1', null);
    expect(store.findById('1')).toBeNull();
  });
});
