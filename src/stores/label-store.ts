import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssueLabel } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class LabelStore {
  pool = new Map<string, DBIssueLabel>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBIssueLabel[] {
    return Array.from(this.pool.values()).filter(l => !l.archivedAt);
  }

  findById(id: string): DBIssueLabel | null {
    return this.pool.get(id) ?? null;
  }

  findByOrgId(orgId: string): DBIssueLabel[] {
    return Array.from(this.pool.values()).filter(l => l.organizationId === orgId && !l.archivedAt);
  }

  upsertMany(labels: DBIssueLabel[]) {
    for (const label of labels) {
      this.pool.set(label.id, label);
    }
  }

  applySyncAction(action: string, id: string, data: DBIssueLabel | null) {
    // Archive keeps the row: issues referencing this label still resolve, and
    // `get all` filters archived ones out of the active lists.
    applyPoolSyncAction(this.pool, action, id, data);
  }
}
