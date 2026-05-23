import { action, computed, makeObservable, observable } from 'mobx';
import type { DBFavorite } from '@/lib/db';

export class FavoriteStore {
  pool = new Map<string, DBFavorite>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBFavorite[] {
    return Array.from(this.pool.values()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  findById(id: string): DBFavorite | null {
    return this.pool.get(id) ?? null;
  }

  getByEntityId(entityId: string): DBFavorite | null {
    return Array.from(this.pool.values()).find(f => f.entityId === entityId) ?? null;
  }

  upsertMany(favorites: DBFavorite[]) {
    for (const f of favorites) {
      this.pool.set(f.id, f);
    }
  }

  applySyncAction(actionType: string, id: string, data: DBFavorite | null) {
    if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (actionType === 'D') {
      this.pool.delete(id);
    }
  }
}
