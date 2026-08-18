import { action, computed, makeObservable, observable } from 'mobx';
import type { DBOrganizationMember } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

/**
 * The current workspace's roster: who belongs to it, and as what.
 *
 * Exists because membership and identity are different facts. Removing someone
 * from an org deletes their `organization_members` row but never their `User`
 * row — nothing deletes Users — so `userStore` alone cannot tell a current
 * member from a departed one. Before this store, `organizationMemberRemove`
 * and `organizationMemberUpdateRole` emitted SyncActions that no client
 * handled: the settings page reconciled its own copy of the roster locally, so
 * a second admin's open tab kept showing someone who had been removed until
 * they reloaded.
 *
 * Keyed by membership id (the SyncAction's `modelId`), with a `userId` lookup
 * for the common "what is this person's role" question.
 */
export class OrganizationMemberStore {
  pool = new Map<string, DBOrganizationMember>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      pool: observable,
      replaceAll: action,
      rolesByUserId: computed,
      upsertMany: action,
    });
  }

  get all(): DBOrganizationMember[] {
    return Array.from(this.pool.values());
  }

  /**
   * `userId -> role` for the whole roster. Computed rather than derived at
   * each call site so components re-render only when the map's contents
   * actually change.
   */
  get rolesByUserId(): Record<string, string> {
    const roles: Record<string, string> = {};
    for (const m of this.pool.values()) {
      roles[m.userId] = m.role;
    }
    return roles;
  }

  findByUserId(userId: string): DBOrganizationMember | null {
    for (const m of this.pool.values()) {
      if (m.userId === userId) {
        return m;
      }
    }
    return null;
  }

  /** How many members hold `role`. Backs the last-owner check in the UI. */
  countByRole(role: string): number {
    let n = 0;
    for (const m of this.pool.values()) {
      if (m.role === role) {
        n++;
      }
    }
    return n;
  }

  upsertMany(members: DBOrganizationMember[]) {
    for (const member of members) {
      this.pool.set(member.id, member);
    }
  }

  /**
   * Replace the pool wholesale — what an authoritative load (a bootstrap)
   * has to do, as opposed to the merge `upsertMany` performs for cache
   * hydration and deltas.
   *
   * `fullBootstrap` is not only the cold-start path; it is also the
   * delta-failure fallback, which runs *after* `loadFromIndexedDB` has
   * already filled the pool from a warm cache. Merging there means a row the
   * server omitted survives, and for membership omission is the whole
   * signal: nobody archives a membership, they stop existing.
   */
  replaceAll(members: DBOrganizationMember[]) {
    this.pool.clear();
    this.upsertMany(members);
  }

  applySyncAction(syncAction: string, id: string, data: DBOrganizationMember | null) {
    // No soft delete here: `organization_members` has no `archivedAt`, so unlike
    // the entity stores 'A' has no distinct meaning and 'D' is the only way a
    // member leaves the pool.
    applyPoolSyncAction(this.pool, syncAction, id, data);
  }
}
