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
      archived: computed,
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

  /** In-session archived initiatives (archived rows never ride the bootstrap). */
  get archived(): DBInitiative[] {
    return Array.from(this.pool.values())
      .filter(i => i.archivedAt)
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }

  /**
   * Every initiative nested anywhere below `id` (children, grandchildren…),
   * excluding `id` itself. Guarded against a cyclic chain.
   */
  getDescendantIds(id: string): Set<string> {
    const found = new Set<string>();
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.pop() as string;
      for (const init of this.pool.values()) {
        if (init.parentId === current && !found.has(init.id) && init.id !== id) {
          found.add(init.id);
          queue.push(init.id);
        }
      }
    }
    return found;
  }

  /**
   * Initiatives that may become `id`'s parent: not itself, not anything below
   * it (that would be a cycle). The server enforces the same rule; this keeps
   * the picker from offering a choice that is bound to be refused.
   */
  getParentCandidates(id: string): DBInitiative[] {
    const below = this.getDescendantIds(id);
    return this.all.filter(i => i.id !== id && !below.has(i.id));
  }

  /**
   * Initiatives the list shows at its top level: those with no parent, plus any
   * whose parent would never render them — missing from the pool (not visible,
   * deleted), archived, or part of a parent cycle. Filtering on `!parentId`
   * alone made a restored or re-parented child vanish: it was no root, and its
   * parent's row never expanded to it.
   */
  get roots(): DBInitiative[] {
    return this.all.filter(i => this.isRoot(i));
  }

  isRoot(i: DBInitiative): boolean {
    if (!i.parentId) {
      return true;
    }
    const parent = this.pool.get(i.parentId);
    if (!parent || parent.archivedAt) {
      return true;
    }
    const seen = new Set<string>([i.id]);
    let cursor: DBInitiative | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) {
        return true;
      }
      seen.add(cursor.id);
      cursor = cursor.parentId ? this.pool.get(cursor.parentId) : undefined;
    }
    return false;
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
