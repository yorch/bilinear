import { action, computed, makeObservable, observable } from 'mobx';
import type { DBNotification } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

export class NotificationStore {
  pool = new Map<string, DBNotification>();
  /** Where the shell's notification fetch stands; the Inbox renders from this. */
  loadState: 'idle' | 'loaded' | 'error' = 'idle';
  /** The last page was full, so older rows exist that were never fetched and counts are lower bounds. */
  hasMore = false;

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      hasMore: observable,
      loadState: observable,
      markAllRead: action,
      markRead: action,
      optimisticUpdate: action,
      pool: observable,
      reconcile: action,
      setLoadState: action,
      unread: computed,
      unreadCount: computed,
      upsertMany: action,
    });
  }

  // Returns all notifications sorted newest-first.
  // Snooze filtering is handled server-side; the pool should not contain
  // active snoozed items. Avoiding `new Date()` here keeps this computed
  // properly cacheable by MobX.
  get all(): DBNotification[] {
    return Array.from(this.pool.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  get unread(): DBNotification[] {
    return this.all.filter(n => !n.read);
  }

  get unreadCount(): number {
    return this.unread.length;
  }

  findById(id: string): DBNotification | null {
    return this.pool.get(id) ?? null;
  }

  markRead(id: string) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, {
        ...existing,
        read: true,
        readAt: new Date().toISOString(),
      });
    }
  }

  // Marks all notifications in the pool as read. The pool is already scoped
  // to the current user/org, so no userId filter is needed.
  markAllRead() {
    const now = new Date().toISOString();
    for (const [id, notification] of this.pool) {
      if (!notification.read) {
        this.pool.set(id, { ...notification, read: true, readAt: now });
      }
    }
  }

  upsertMany(notifications: DBNotification[]) {
    for (const notification of notifications) {
      this.pool.set(notification.id, notification);
    }
  }

  /**
   * Make the pool agree with a fresh page of the server's list: upsert the
   * rows, and drop pooled rows the server no longer returns (snoozed, deleted
   * or acted on from another device) — which `upsertMany` alone never did, so
   * the unread badge over-counted until a full reload.
   *
   * `limit` is the page size requested. A full page may have cut off older
   * rows, so only pooled rows at least as new as the oldest returned one can be
   * judged absent; a short page is the whole list and everything absent goes.
   */
  setLoadState(state: 'idle' | 'loaded' | 'error') {
    this.loadState = state;
  }

  reconcile(notifications: DBNotification[], limit: number) {
    this.hasMore = notifications.length >= limit;
    const returned = new Set(notifications.map(n => n.id));
    const oldest =
      notifications.length >= limit
        ? Math.min(...notifications.map(n => new Date(n.createdAt).getTime()))
        : Number.NEGATIVE_INFINITY;
    for (const [id, existing] of this.pool) {
      if (!returned.has(id) && new Date(existing.createdAt).getTime() >= oldest) {
        this.pool.delete(id);
      }
    }
    this.upsertMany(notifications);
  }

  optimisticUpdate(id: string, patch: Partial<DBNotification>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(actionType: string, id: string, data: DBNotification | null) {
    applyPoolSyncAction(this.pool, actionType, id, data);
  }
}
