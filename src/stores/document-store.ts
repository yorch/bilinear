import { action, computed, makeObservable, observable } from 'mobx';
import type { DBDocument } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class DocumentStore {
  pool = new Map<string, DBDocument>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      optimisticUpdate: action,
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

  /**
   * A live document is a list root when nothing visible would nest it: no
   * parent, or a parent that is missing from the pool (not visible, deleted),
   * archived, or part of a parent cycle. Filtering on `!parentId` alone made a
   * restored or re-parented child vanish from every list — it was neither a
   * root nor reachable under an absent parent.
   */
  isRoot(d: DBDocument): boolean {
    if (!d.parentId) {
      return true;
    }
    const parent = this.pool.get(d.parentId);
    if (!parent || parent.archivedAt) {
      return true;
    }
    // A cycle (legacy data) would hide every member; surface them instead.
    const seen = new Set<string>([d.id]);
    let cursor: DBDocument | undefined = parent;
    while (cursor) {
      if (seen.has(cursor.id)) {
        return true;
      }
      seen.add(cursor.id);
      cursor = cursor.parentId ? this.pool.get(cursor.parentId) : undefined;
    }
    return false;
  }

  /** Live roots across the whole workspace. */
  getRoots(): DBDocument[] {
    return this.all.filter(d => this.isRoot(d));
  }

  getByTeamId(teamId: string): DBDocument[] {
    return this.all.filter(d => d.teamId === teamId && this.isRoot(d));
  }

  getByProjectId(projectId: string): DBDocument[] {
    return this.all.filter(d => d.projectId === projectId && this.isRoot(d));
  }

  getChildren(parentId: string): DBDocument[] {
    return this.all.filter(d => d.parentId === parentId);
  }

  /**
   * Archived roots in a scope. Archived rows never ride the bootstrap, so this
   * is only populated after an explicit fetch (or an in-session archive) — the
   * Archived view loads them first, then reads them here.
   */
  getArchived(scope: { projectId?: string; teamId?: string }): DBDocument[] {
    return Array.from(this.pool.values())
      .filter(
        d =>
          d.archivedAt &&
          (scope.teamId ? d.teamId === scope.teamId : true) &&
          (scope.projectId ? d.projectId === scope.projectId : true),
      )
      .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  }

  /**
   * The chain of parents above a document, root first (excludes the document).
   * Stops at a missing parent and at a repeat, so a corrupt cycle cannot hang a
   * render.
   */
  getAncestors(id: string): DBDocument[] {
    const chain: DBDocument[] = [];
    const seen = new Set<string>([id]);
    let cursor = this.pool.get(id)?.parentId ?? null;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const parent = this.pool.get(cursor);
      if (!parent) {
        break;
      }
      chain.unshift(parent);
      cursor = parent.parentId ?? null;
    }
    return chain;
  }

  optimisticUpdate(id: string, patch: Partial<DBDocument>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  upsertMany(docs: DBDocument[]) {
    for (const doc of docs) {
      this.pool.set(doc.id, doc);
    }
  }

  applySyncAction(actionType: string, id: string, data: DBDocument | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
  }
}
