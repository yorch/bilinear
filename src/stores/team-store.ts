import { action, computed, makeObservable, observable } from 'mobx';
import type { DBTeam } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class TeamStore {
  pool = new Map<string, DBTeam>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBTeam[] {
    return Array.from(this.pool.values()).filter(t => !t.archivedAt);
  }

  findById(id: string): DBTeam | null {
    return this.pool.get(id) ?? null;
  }

  findByKey(key: string): DBTeam | null {
    for (const team of this.pool.values()) {
      if (team.key === key) {
        return team;
      }
    }
    return null;
  }

  upsertMany(teams: DBTeam[]) {
    for (const team of teams) {
      this.pool.set(team.id, team);
    }
  }

  applySyncAction(action: string, id: string, data: DBTeam | null) {
    // Archive is an upsert that flips archivedAt — NOT a hard delete. `get all`
    // already filters by archivedAt, so the UI hides the row without forcing every
    // other reference (e.g. an issue's teamId) to dangle. 'D' still removes it.
    applyPoolSyncAction(this.pool, action, id, data);
  }
}
