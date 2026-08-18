import { action, computed, makeObservable, observable } from 'mobx';
import type { DBCustomFieldDefinition, DBCustomFieldValue } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class CustomFieldStore {
  definitions = new Map<string, DBCustomFieldDefinition>();
  /** Values keyed by `${issueId}:${definitionId}` for O(1) lookup. */
  values = new Map<string, DBCustomFieldValue>();

  constructor() {
    makeObservable(this, {
      activeDefinitions: computed,
      applyDefinitionSyncAction: action,
      applyValueSyncAction: action,
      definitions: observable,
      removeValuesForIssue: action,
      upsertDefinitions: action,
      upsertValues: action,
      values: observable,
    });
  }

  static valueKey(issueId: string, definitionId: string): string {
    return `${issueId}:${definitionId}`;
  }

  get activeDefinitions(): DBCustomFieldDefinition[] {
    return Array.from(this.definitions.values())
      .filter(d => !d.archivedAt)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
  }

  findDefinitionById(id: string): DBCustomFieldDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  /**
   * Returns team-scoped definitions for `teamId` PLUS workspace-scoped
   * definitions (teamId IS NULL) in the same org. Workspace definitions
   * render first (matching the server's `orderBy: [{ teamId: 'asc' }, …]`)
   * so workspace-wide fields stay grouped at the top of the picker UI
   * instead of intermixing with team-scoped ones.
   */
  findDefinitionsByTeamId(teamId: string): DBCustomFieldDefinition[] {
    return this.activeDefinitions
      .filter(d => d.teamId === teamId || d.teamId === null)
      .sort((a, b) => {
        // Workspace-scoped (null) first
        if (a.teamId === null && b.teamId !== null) {
          return -1;
        }
        if (a.teamId !== null && b.teamId === null) {
          return 1;
        }
        // Then by sortOrder, then by name (matches server ordering).
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
  }

  findValue(issueId: string, definitionId: string): DBCustomFieldValue | null {
    return this.values.get(CustomFieldStore.valueKey(issueId, definitionId)) ?? null;
  }

  findValuesForIssue(issueId: string): DBCustomFieldValue[] {
    const result: DBCustomFieldValue[] = [];
    for (const v of this.values.values()) {
      if (v.issueId === issueId) {
        result.push(v);
      }
    }
    return result;
  }

  upsertDefinitions(defs: DBCustomFieldDefinition[]) {
    for (const d of defs) {
      this.definitions.set(d.id, d);
    }
  }

  upsertValues(vals: DBCustomFieldValue[]) {
    for (const v of vals) {
      this.values.set(CustomFieldStore.valueKey(v.issueId, v.definitionId), v);
    }
  }

  removeValuesForIssue(issueId: string) {
    for (const [key, v] of this.values) {
      if (v.issueId === issueId) {
        this.values.delete(key);
      }
    }
  }

  applyDefinitionSyncAction(actionType: string, id: string, data: DBCustomFieldDefinition | null) {
    applyPoolSyncAction(this.definitions, actionType, id, data);
    if (actionType === 'D') {
      // Drop any values tied to this definition so stale rows don't linger.
      for (const [key, v] of this.values) {
        if (v.definitionId === id) {
          this.values.delete(key);
        }
      }
    }
  }

  /**
   * Value changes ride the 'Issue' sync stream with shape
   * `{ customFieldValues: DBCustomFieldValue[] }` — this replaces the entire
   * set of values for the issue.
   */
  applyValueSyncAction(
    actionType: string,
    issueId: string,
    data: { customFieldValues?: DBCustomFieldValue[] } | null,
  ) {
    if (actionType === 'D') {
      this.removeValuesForIssue(issueId);
      return;
    }
    if (!data?.customFieldValues) {
      return;
    }
    this.removeValuesForIssue(issueId);
    this.upsertValues(data.customFieldValues);
  }
}
