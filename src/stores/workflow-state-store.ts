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
    if (action === 'I' || action === 'U') {
      if (data) this.pool.set(id, data);
    } else if (action === 'D' || action === 'A') {
      this.pool.delete(id);
    }
  }
}
