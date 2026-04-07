import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssue } from '@/lib/db';

export class IssueStore {
  pool = new Map<string, DBIssue>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => !i.trashed && !i.archivedAt,
    );
  }

  findById(id: string): DBIssue | null {
    return this.pool.get(id) ?? null;
  }

  findByTeamId(teamId: string): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => i.teamId === teamId && !i.trashed && !i.archivedAt,
    );
  }

  findByStateId(stateId: string): DBIssue[] {
    return Array.from(this.pool.values()).filter(
      i => i.stateId === stateId && !i.trashed && !i.archivedAt,
    );
  }

  /**
   * Optimistically apply a partial patch to an issue in the pool.
   * Used by TransactionQueue before the server responds.
   */
  optimisticUpdate(id: string, patch: Partial<DBIssue>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  upsertMany(issues: DBIssue[]) {
    for (const issue of issues) {
      this.pool.set(issue.id, issue);
    }
  }

  applySyncAction(action: string, id: string, data: DBIssue | null) {
    if (action === 'I' || action === 'U') {
      if (data) this.pool.set(id, data);
    } else if (action === 'D') {
      this.pool.delete(id);
    } else if (action === 'A') {
      // Archive: keep in pool but mark archivedAt so it's filtered from .all
      if (data) this.pool.set(id, data);
    }
  }
}
