import { action, computed, makeObservable, observable } from 'mobx';
import type { DBOrganizationMember } from '@/lib/db';

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

  applySyncAction(syncAction: string, id: string, data: DBOrganizationMember | null) {
    // No soft delete here: `organization_members` has no `archivedAt`, and
    // removal really is a row delete — so unlike the entity stores, 'A' has no
    // distinct meaning and 'D' is the only way a member leaves the pool.
    if (syncAction === 'I' || syncAction === 'U' || syncAction === 'A') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (syncAction === 'D') {
      this.pool.delete(id);
    }
  }
}
