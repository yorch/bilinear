import { action, computed, makeObservable, observable } from 'mobx';
import type { DBCycle } from '@/lib/db';

export class CycleStore {
  pool = new Map<string, DBCycle>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      optimisticUpdate: action,
      pool: observable,
      upsertMany: action,
    });
  }

  get all(): DBCycle[] {
    return Array.from(this.pool.values())
      .filter(c => !c.archivedAt)
      .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  }

  findById(id: string): DBCycle | null {
    return this.pool.get(id) ?? null;
  }

  findByTeamId(teamId: string): DBCycle[] {
    return this.all.filter(c => c.teamId === teamId);
  }

  getActiveCycle(teamId: string): DBCycle | null {
    const now = Date.now();
    return (
      this.findByTeamId(teamId).find(
        c =>
          !c.completedAt &&
          new Date(c.startsAt).getTime() <= now &&
          new Date(c.endsAt).getTime() > now,
      ) ?? null
    );
  }

  getUpcomingCycles(teamId: string): DBCycle[] {
    const now = Date.now();
    return this.findByTeamId(teamId)
      .filter(c => new Date(c.startsAt).getTime() > now)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }

  getCompletedCycles(teamId: string): DBCycle[] {
    const now = Date.now();
    return this.findByTeamId(teamId).filter(
      c => c.completedAt || new Date(c.endsAt).getTime() <= now,
    );
  }

  upsertMany(cycles: DBCycle[]) {
    for (const cycle of cycles) {
      this.pool.set(cycle.id, cycle);
    }
  }

  optimisticUpdate(id: string, patch: Partial<DBCycle>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(actionType: string, id: string, data: DBCycle | null) {
    if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (actionType === 'D') {
      this.pool.delete(id);
    }
  }
}
