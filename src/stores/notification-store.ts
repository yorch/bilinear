import { action, computed, makeObservable, observable } from 'mobx';
import type { DBNotification } from '@/lib/db';

export class NotificationStore {
  pool = new Map<string, DBNotification>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      markAllRead: action,
      markRead: action,
      optimisticUpdate: action,
      pool: observable,
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
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
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

  optimisticUpdate(id: string, patch: Partial<DBNotification>) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(actionType: string, id: string, data: DBNotification | null) {
    if (actionType === 'I' || actionType === 'U' || actionType === 'A') {
      if (data) {
        this.pool.set(id, data);
      }
    } else if (actionType === 'D') {
      this.pool.delete(id);
    }
  }
}
