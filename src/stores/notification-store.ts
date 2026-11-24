import { action, computed, makeObservable, observable, reaction } from 'mobx';
import type { DBNotification } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

function isSnoozedAt(n: { snoozedUntilAt?: string | null }, now: number): boolean {
  return n.snoozedUntilAt ? new Date(n.snoozedUntilAt).getTime() > now : false;
}

export class NotificationStore {
  pool = new Map<string, DBNotification>();
  /** Where the shell's notification fetch stands; the Inbox renders from this. */
  loadState: 'idle' | 'loaded' | 'error' = 'idle';
  /** The last page was full, so older rows exist that were never fetched and counts are lower bounds. */
  hasMore = false;
  /**
   * The server's own unread total (`notificationUnreadCount`), or null before
   * the first fetch. The pool only ever holds the newest page(s), so counting
   * it undercounts whenever unread rows sit beyond the first 50 — the badge
   * read "7 unread" while the database held 29.
   */
  serverUnread: number | null = null;
  /** Pool-derived active-unread count at the moment `serverUnread` was read. */
  baselineUnread = 0;
  /**
   * "Now" as the computeds see it. Reading `Date.now()` inside a computed caches
   * it, so a snooze elapsing changed nothing until some unrelated store write —
   * the badge and the Unread list stayed one row short. This observable is
   * bumped at the next snooze expiry (see the reaction below) and on every pool
   * write, so those computeds re-run exactly when the answer can change.
   */
  clock = Date.now();
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposeWakeup: () => void;

  constructor() {
    makeObservable(this, {
      all: computed,
      appendPage: action,
      applySyncAction: action,
      baselineUnread: observable,
      clock: observable,
      hasMore: observable,
      loadState: observable,
      markAllRead: action,
      markRead: action,
      markUnread: action,
      nextSnoozeExpiry: computed,
      oldestActiveCreatedAt: computed,
      optimisticUpdate: action,
      pool: observable,
      reconcile: action,
      refreshClock: action,
      serverUnread: observable,
      setLoadState: action,
      snoozed: computed,
      unread: computed,
      unreadCount: computed,
      upsertMany: action,
    });
    this.disposeWakeup = reaction(
      () => this.nextSnoozeExpiry,
      at => {
        if (this.wakeTimer) {
          clearTimeout(this.wakeTimer);
          this.wakeTimer = null;
        }
        if (at === null || typeof window === 'undefined') {
          return;
        }
        // setTimeout caps at ~24.8 days; a longer snooze re-arms when the clock bumps.
        const delay = Math.min(Math.max(at - Date.now(), 0) + 50, 2 ** 31 - 1);
        this.wakeTimer = setTimeout(() => this.refreshClock(), delay);
      },
      { fireImmediately: true },
    );
  }

  /** Stop the wake-up timer (tests, store teardown). */
  dispose() {
    this.disposeWakeup();
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  refreshClock() {
    this.clock = Date.now();
  }

  /** When the soonest still-running snooze ends (epoch ms), or null when none is running. */
  get nextSnoozeExpiry(): number | null {
    let next: number | null = null;
    for (const n of this.pool.values()) {
      if (!n.snoozedUntilAt) {
        continue;
      }
      const at = new Date(n.snoozedUntilAt).getTime();
      if (at > this.clock && (next === null || at < next)) {
        next = at;
      }
    }
    return next;
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

  /** Unread rows that are not currently snoozed. */
  get unread(): DBNotification[] {
    const now = this.clock;
    return this.all.filter(n => !n.read && !isSnoozedAt(n, now));
  }

  /**
   * The badge number. Once the server total is known it is that total moved by
   * however many pooled rows have flipped since (optimistic mark-read, snooze,
   * mark-unread) — so it stays exact past the first page and still reacts at
   * once to local edits. Before the first fetch it falls back to the pool.
   */
  get unreadCount(): number {
    const pooled = this.unread.length;
    if (this.serverUnread === null) {
      return pooled;
    }
    return Math.max(0, this.serverUnread + pooled - this.baselineUnread);
  }

  /** Rows whose snooze has not elapsed, soonest-waking first. */
  get snoozed(): DBNotification[] {
    const now = this.clock;
    return this.all
      .filter(n => isSnoozedAt(n, now))
      .sort(
        (a, b) =>
          new Date(a.snoozedUntilAt ?? 0).getTime() - new Date(b.snoozedUntilAt ?? 0).getTime(),
      );
  }

  /** The oldest unsnoozed row held — the `before` cursor for "Load more". */
  get oldestActiveCreatedAt(): string | null {
    const now = this.clock;
    let oldest: string | null = null;
    for (const n of this.pool.values()) {
      if (!isSnoozedAt(n, now) && (oldest === null || n.createdAt < oldest)) {
        oldest = n.createdAt;
      }
    }
    return oldest;
  }

  findById(id: string): DBNotification | null {
    return this.pool.get(id) ?? null;
  }

  markUnread(id: string) {
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, read: false, readAt: null });
    }
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
    // The server cleared every unread row, including ones beyond the pooled
    // page. Leaving the old total/baseline made the badge keep the unpooled
    // remainder (29 server - 7 pooled = 22) after "Mark all read".
    if (this.serverUnread !== null) {
      this.serverUnread = 0;
      this.baselineUnread = 0;
    }
    for (const [id, notification] of this.pool) {
      if (!notification.read) {
        this.pool.set(id, { ...notification, read: true, readAt: now });
      }
    }
  }

  upsertMany(notifications: DBNotification[]) {
    this.clock = Date.now();
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

  reconcile(notifications: DBNotification[], limit: number, serverUnread?: number) {
    this.clock = Date.now();
    this.hasMore = notifications.length >= limit;
    const returned = new Set(notifications.map(n => n.id));
    const oldest =
      notifications.length >= limit
        ? Math.min(...notifications.map(n => new Date(n.createdAt).getTime()))
        : Number.NEGATIVE_INFINITY;
    for (const [id, existing] of this.pool) {
      // A snoozed row is absent from the default list by design, not because
      // it is gone — keep it for the Snoozed view (it wakes by its own date).
      if (
        !returned.has(id) &&
        !isSnoozedAt(existing, Date.now()) &&
        new Date(existing.createdAt).getTime() >= oldest
      ) {
        this.pool.delete(id);
      }
    }
    this.upsertMany(notifications);
    if (serverUnread !== undefined) {
      this.serverUnread = serverUnread;
      this.baselineUnread = this.unread.length;
    }
  }

  /**
   * Append an older page ("Load more"). Rows new to the pool that are unread
   * raise the pooled count without the server total moving, so they are folded
   * into the baseline.
   */
  appendPage(notifications: DBNotification[], limit: number) {
    this.hasMore = notifications.length >= limit;
    this.clock = Date.now();
    const now = this.clock;
    for (const n of notifications) {
      if (!this.pool.has(n.id) && !n.read && !isSnoozedAt(n, now)) {
        this.baselineUnread += 1;
      }
    }
    this.upsertMany(notifications);
  }

  optimisticUpdate(id: string, patch: Partial<DBNotification>) {
    this.clock = Date.now();
    const existing = this.pool.get(id);
    if (existing) {
      this.pool.set(id, { ...existing, ...patch });
    }
  }

  applySyncAction(actionType: string, id: string, data: DBNotification | null) {
    this.clock = Date.now();
    applyPoolSyncAction(this.pool, actionType, id, data);
  }
}
