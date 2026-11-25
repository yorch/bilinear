import { action, computed, makeObservable, observable } from 'mobx';
import type { DBFavorite } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class FavoriteStore {
  pool = new Map<string, DBFavorite>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      replaceAll: action,
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

  /**
   * Authoritative load of the caller's own favourites. Favourites are a
   * per-user model the bootstrap stream does not carry, so the sidebar's query
   * is what fills this pool; replacing (not merging) also drops rows removed
   * elsewhere. No-ops when nothing changed so an observer keyed on the pool
   * does not refetch in a loop.
   */
  replaceAll(favorites: DBFavorite[]) {
    const next = new Map(favorites.map(f => [f.id, f]));
    const same =
      next.size === this.pool.size &&
      favorites.every(f => {
        const cur = this.pool.get(f.id);
        return cur && cur.sortOrder === f.sortOrder && cur.entityId === f.entityId;
      });
    if (same) {
      return;
    }
    this.pool.clear();
    for (const f of favorites) {
      this.pool.set(f.id, f);
    }
  }

  applySyncAction(actionType: string, id: string, data: DBFavorite | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
  }
}
