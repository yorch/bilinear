import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssueLabel } from '@/lib/db';

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
    return Array.from(this.pool.values()).filter(
      l => l.organizationId === orgId && !l.archivedAt,
    );
  }

  upsertMany(labels: DBIssueLabel[]) {
    for (const label of labels) {
      this.pool.set(label.id, label);
    }
  }

  applySyncAction(action: string, id: string, data: DBIssueLabel | null) {
    if (action === 'I' || action === 'U') {
      if (data) this.pool.set(id, data);
    } else if (action === 'D' || action === 'A') {
      this.pool.delete(id);
    }
  }
}
