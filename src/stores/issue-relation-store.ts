import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssueRelation } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class IssueRelationStore {
  pool = new Map<string, DBIssueRelation>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      optimisticUpdate: action,
      pool: observable,
      removeForIssue: action,
      upsertMany: action,
    });
  }

  get all(): DBIssueRelation[] {
    return Array.from(this.pool.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  findById(id: string): DBIssueRelation | null {
    return this.pool.get(id) ?? null;
  }

  findByIssueId(issueId: string): DBIssueRelation[] {
    return this.all.filter(r => r.issueId === issueId || r.relatedIssueId === issueId);
  }

  /** Drop every edge touching `issueId` — mirrors Postgres' cascade on a hard delete. */
  removeForIssue(issueId: string) {
    for (const [id, r] of this.pool) {
      if (r.issueId === issueId || r.relatedIssueId === issueId) {
        this.pool.delete(id);
      }
    }
  }

  upsertMany(relations: DBIssueRelation[]) {
    for (const relation of relations) {
      this.pool.set(relation.id, relation);
    }
  }

  optimisticUpdate(id: string, patch: Partial<DBIssueRelation>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(actionType: string, id: string, data: DBIssueRelation | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
  }
}
