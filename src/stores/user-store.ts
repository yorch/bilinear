import { action, computed, makeObservable, observable } from 'mobx';
import type { DBUser } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class UserStore {
  pool = new Map<string, DBUser>();
  currentUserId: string | null = null;

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      currentUser: computed,
      currentUserId: observable,
      pool: observable,
      setCurrentUserId: action,
      upsertMany: action,
    });
  }

  get all(): DBUser[] {
    return Array.from(this.pool.values());
  }

  get currentUser(): DBUser | null {
    return this.currentUserId ? (this.pool.get(this.currentUserId) ?? null) : null;
  }

  findById(id: string): DBUser | null {
    return this.pool.get(id) ?? null;
  }

  setCurrentUserId(id: string) {
    this.currentUserId = id;
  }

  upsertMany(users: DBUser[]) {
    for (const user of users) {
      this.pool.set(user.id, user);
    }
  }

  applySyncAction(action: string, id: string, data: DBUser | null) {
    // Archive keeps the row so existing references (e.g. an issue's creatorId)
    // still resolve to a name; consumers filter on `active` themselves.
    applyPoolSyncAction(this.pool, action, id, data);
  }
}
