import { action, computed, makeObservable, observable } from 'mobx';
import type { DBWorkflowState } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class WorkflowStateStore {
  pool = new Map<string, DBWorkflowState>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBWorkflowState[] {
    return Array.from(this.pool.values()).filter(s => !s.archivedAt);
  }

  findById(id: string): DBWorkflowState | null {
    return this.pool.get(id) ?? null;
  }

  findByTeamId(teamId: string): DBWorkflowState[] {
    return Array.from(this.pool.values())
      .filter(s => s.teamId === teamId && !s.archivedAt)
      .sort((a, b) => a.position - b.position);
  }

  upsertMany(states: DBWorkflowState[]) {
    for (const state of states) {
      this.pool.set(state.id, state);
    }
  }

  applySyncAction(action: string, id: string, data: DBWorkflowState | null) {
    // Archive keeps the row: issues referencing this state still resolve, and
    // `get all` filters archived ones out of the active lists.
    applyPoolSyncAction(this.pool, action, id, data);
  }
}
