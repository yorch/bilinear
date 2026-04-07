import { action, computed, makeObservable, observable } from 'mobx';
import type { DBWorkflowState } from '@/lib/db';

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
    if (action === 'I' || action === 'U' || action === 'A') {
      // Archive: keep in pool with archivedAt set so issues referencing this
      // state still resolve; filtered from active lists via archivedAt check
      if (data) this.pool.set(id, data);
    } else if (action === 'D') {
      this.pool.delete(id);
    }
  }
}
