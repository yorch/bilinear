import { action, computed, makeObservable, observable } from 'mobx';
import type { DBDocument } from '@/lib/db';

export class DocumentStore {
  pool = new Map<string, DBDocument>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBDocument[] {
    return Array.from(this.pool.values())
      .filter(d => !d.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }

  findById(id: string): DBDocument | null {
    return this.pool.get(id) ?? null;
  }

  getByTeamId(teamId: string): DBDocument[] {
    return this.all.filter(d => d.teamId === teamId && !d.parentId);
  }

  getByProjectId(projectId: string): DBDocument[] {
    return this.all.filter(d => d.projectId === projectId && !d.parentId);
  }

  getChildren(parentId: string): DBDocument[] {
    return this.all.filter(d => d.parentId === parentId);
  }

  upsertMany(docs: DBDocument[]) {
    for (const doc of docs) {
      this.pool.set(doc.id, doc);
    }
  }

  applySyncAction(actionType: string, id: string, data: DBDocument | null) {
    if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (actionType === 'D') {
      this.pool.delete(id);
    }
  }
}
