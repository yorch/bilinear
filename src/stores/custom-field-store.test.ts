import { beforeEach, describe, expect, it } from 'vitest';
import type { DBCustomFieldDefinition, DBCustomFieldValue } from '@/lib/db';
import { CustomFieldStore } from './custom-field-store';

function makeDef(
  overrides: Partial<DBCustomFieldDefinition> & { id: string },
): DBCustomFieldDefinition {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    name: 'Severity',
    organizationId: 'org-1',
    required: false,
    sortOrder: 0,
    teamId: null,
    type: 'text',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeValue(
  overrides: Partial<DBCustomFieldValue> & { id: string; issueId: string; definitionId: string },
): DBCustomFieldValue {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    value: 'high',
    ...overrides,
  };
}

describe('CustomFieldStore', () => {
  let store: CustomFieldStore;

  beforeEach(() => {
    store = new CustomFieldStore();
  });

  describe('valueKey', () => {
    it('composes a stable composite key', () => {
      expect(CustomFieldStore.valueKey('issue-1', 'def-1')).toBe('issue-1:def-1');
    });
  });

  describe('activeDefinitions', () => {
    it('excludes archived and sorts by sortOrder then name', () => {
      store.upsertDefinitions([
        makeDef({ id: 'a', name: 'Zeta', sortOrder: 0 }),
        makeDef({ id: 'b', name: 'Alpha', sortOrder: 0 }),
        makeDef({ id: 'c', name: 'Mid', sortOrder: 1 }),
        makeDef({ archivedAt: '2026-02-01T00:00:00Z', id: 'd', name: 'Gone' }),
      ]);
      expect(store.activeDefinitions.map(d => d.id)).toEqual(['b', 'a', 'c']);
    });
  });

  describe('findDefinitionsByTeamId', () => {
    it('returns workspace (null) definitions first, then team-scoped', () => {
      store.upsertDefinitions([
        makeDef({ id: 'team', name: 'TeamField', sortOrder: 0, teamId: 'team-1' }),
        makeDef({ id: 'ws', name: 'WorkspaceField', sortOrder: 5, teamId: null }),
        makeDef({ id: 'other', teamId: 'team-2' }),
      ]);
      expect(store.findDefinitionsByTeamId('team-1').map(d => d.id)).toEqual(['ws', 'team']);
    });
  });

  describe('values', () => {
    it('upserts and finds by composite key', () => {
      store.upsertValues([makeValue({ definitionId: 'def-1', id: 'v1', issueId: 'issue-1' })]);
      expect(store.findValue('issue-1', 'def-1')?.id).toBe('v1');
      expect(store.findValue('issue-1', 'missing')).toBeNull();
    });

    it('findValuesForIssue returns all values for an issue', () => {
      store.upsertValues([
        makeValue({ definitionId: 'def-1', id: 'v1', issueId: 'issue-1' }),
        makeValue({ definitionId: 'def-2', id: 'v2', issueId: 'issue-1' }),
        makeValue({ definitionId: 'def-1', id: 'v3', issueId: 'issue-2' }),
      ]);
      expect(
        store
          .findValuesForIssue('issue-1')
          .map(v => v.id)
          .sort(),
      ).toEqual(['v1', 'v2']);
    });

    it('removeValuesForIssue drops only that issue values', () => {
      store.upsertValues([
        makeValue({ definitionId: 'def-1', id: 'v1', issueId: 'issue-1' }),
        makeValue({ definitionId: 'def-1', id: 'v3', issueId: 'issue-2' }),
      ]);
      store.removeValuesForIssue('issue-1');
      expect(store.findValuesForIssue('issue-1')).toEqual([]);
      expect(store.findValuesForIssue('issue-2')).toHaveLength(1);
    });
  });

  describe('applyDefinitionSyncAction', () => {
    it('upserts on I/U/A', () => {
      store.applyDefinitionSyncAction('I', 'a', makeDef({ id: 'a' }));
      expect(store.findDefinitionById('a')).not.toBeNull();
    });

    it('on D removes the definition and cascades its values', () => {
      store.upsertDefinitions([makeDef({ id: 'a' })]);
      store.upsertValues([
        makeValue({ definitionId: 'a', id: 'v1', issueId: 'issue-1' }),
        makeValue({ definitionId: 'b', id: 'v2', issueId: 'issue-1' }),
      ]);
      store.applyDefinitionSyncAction('D', 'a', null);
      expect(store.findDefinitionById('a')).toBeNull();
      expect(store.findValue('issue-1', 'a')).toBeNull();
      expect(store.findValue('issue-1', 'b')).not.toBeNull();
    });
  });

  describe('applyValueSyncAction', () => {
    it('replaces the entire value set for an issue', () => {
      store.upsertValues([makeValue({ definitionId: 'old', id: 'v-old', issueId: 'issue-1' })]);
      store.applyValueSyncAction('U', 'issue-1', {
        customFieldValues: [makeValue({ definitionId: 'new', id: 'v-new', issueId: 'issue-1' })],
      });
      expect(store.findValue('issue-1', 'old')).toBeNull();
      expect(store.findValue('issue-1', 'new')?.id).toBe('v-new');
    });

    it('clears values on D', () => {
      store.upsertValues([makeValue({ definitionId: 'd', id: 'v1', issueId: 'issue-1' })]);
      store.applyValueSyncAction('D', 'issue-1', null);
      expect(store.findValuesForIssue('issue-1')).toEqual([]);
    });

    it('is a no-op when data has no customFieldValues', () => {
      store.upsertValues([makeValue({ definitionId: 'd', id: 'v1', issueId: 'issue-1' })]);
      store.applyValueSyncAction('U', 'issue-1', {});
      expect(store.findValuesForIssue('issue-1')).toHaveLength(1);
    });
  });
});
