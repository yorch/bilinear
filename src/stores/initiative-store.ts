import { action, computed, makeObservable, observable } from 'mobx';
import type { DBInitiative, DBInitiativeProject } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class InitiativeStore {
  pool = new Map<string, DBInitiative>();
  projectLinks = new Map<string, DBInitiativeProject>();

  constructor() {
    makeObservable(this, {
      active: computed,
      all: computed,
      applyInitiativeProjectSyncAction: action,
      applySyncAction: action,
      optimisticUpdate: action,
      pool: observable,
      projectLinks: observable,
      roots: computed,
      upsertMany: action,
      upsertProjectLinks: action,
    });
  }

  get all(): DBInitiative[] {
    return Array.from(this.pool.values())
      .filter(i => !i.archivedAt)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  get active(): DBInitiative[] {
    return this.all.filter(i => i.status === 'active' || i.status === 'planned');
  }

  /** Root initiatives (no parent). */
  get roots(): DBInitiative[] {
    return this.all.filter(i => !i.parentId);
  }

  findById(id: string): DBInitiative | null {
    return this.pool.get(id) ?? null;
  }

  /** Direct children of an initiative, sorted. */
  getChildren(parentId: string): DBInitiative[] {
    return this.all.filter(i => i.parentId === parentId);
  }

  /** Project ids associated with this initiative, ordered by sortOrder. */
  getProjectIds(initiativeId: string): string[] {
    return Array.from(this.projectLinks.values())
      .filter(l => l.initiativeId === initiativeId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(l => l.projectId);
  }

  /** Initiatives that include a given project. */
  getInitiativesForProject(projectId: string): DBInitiative[] {
    const initiativeIds = Array.from(this.projectLinks.values())
      .filter(l => l.projectId === projectId)
      .map(l => l.initiativeId);
    return initiativeIds.flatMap(id => {
      const init = this.pool.get(id);
      return init && !init.archivedAt ? [init] : [];
    });
  }

  upsertMany(initiatives: DBInitiative[]) {
    for (const init of initiatives) {
      this.pool.set(init.id, init);
    }
  }

  upsertProjectLinks(links: DBInitiativeProject[]) {
    for (const l of links) {
      this.projectLinks.set(l.id, l);
    }
  }

  optimisticUpdate(id: string, patch: Partial<DBInitiative>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(actionType: string, id: string, data: DBInitiative | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
    if (actionType === 'D') {
      // Cascade-delete any project links — server has FK CASCADE on initiativeId.
      for (const [linkId, link] of this.projectLinks) {
        if (link.initiativeId === id) {
          this.projectLinks.delete(linkId);
        }
      }
    }
  }

  /**
   * Deliberately not delegated to `applyPoolSyncAction`: that helper treats
   * `'A'` as an upsert, and this stream never carries one. The server emits
   * exactly two verbs for `InitiativeProject` — `'I'` when a project is linked
   * (`resolvers/initiative.ts:112` and the create fan-out at `:195`) and `'D'`
   * when it is unlinked (`:255`). There is no archive path, and
   * `resolvers/project.ts:197` documents why archiving a project deliberately
   * does *not* emit one. `'U'` is accepted here for symmetry; nothing sends it.
   */
  applyInitiativeProjectSyncAction(
    actionType: string,
    id: string,
    data: DBInitiativeProject | null,
  ) {
    if (actionType === 'I' || actionType === 'U') {
      if (data) {
        this.projectLinks.set(id, data);
      }
    } else if (actionType === 'D') {
      this.projectLinks.delete(id);
    }
  }
}
