import { action, computed, makeObservable, observable } from 'mobx';
import type { DBCustomView } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class CustomViewStore {
  pool = new Map<string, DBCustomView>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBCustomView[] {
    return Array.from(this.pool.values())
      .filter(v => !v.archivedAt)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  findById(id: string): DBCustomView | null {
    return this.pool.get(id) ?? null;
  }

  getByTeamId(teamId: string): DBCustomView[] {
    return this.all.filter(v => v.teamId === teamId);
  }

  getOrgViews(): DBCustomView[] {
    return this.all.filter(v => !v.teamId);
  }

  upsertMany(views: DBCustomView[]) {
    for (const view of views) {
      this.pool.set(view.id, view);
    }
  }

  applySyncAction(actionType: string, id: string, data: DBCustomView | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
  }
}
