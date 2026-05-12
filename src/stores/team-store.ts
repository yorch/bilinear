import { action, computed, makeObservable, observable } from 'mobx';
import type { DBTeam } from '@/lib/db';

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
    if (action === 'I' || action === 'U' || action === 'A') {
      // Archive is an upsert that flips archivedAt — NOT a hard delete.
      // `get all` already filters by archivedAt, so existing UI hides the
      // row without forcing every other store reference (e.g. an issue's
      // teamId) to dangle. Hard delete still removes from the pool.
      if (data) {
        this.pool.set(id, data);
      }
    } else if (action === 'D') {
      this.pool.delete(id);
    }
  }
}
