import { action, computed, makeObservable, observable } from 'mobx';
import type { DBIssueReminder } from '@/lib/db';
import { applyPoolSyncAction } from './apply-pool-sync-action';

/** Id prefix of a reminder the server has not confirmed yet (optimistic, or queued offline). */
export const OPTIMISTIC_REMINDER_PREFIX = 'optimistic:';

/**
 * Whether a reminder should still be shown at `now`. A reminder whose time has
 * passed is hidden even before the sweep's delete reaches this client (the
 * sweep runs every 30 s, and an offline client may not hear of it for much
 * longer); the delete then removes the row for good.
 */
export function isReminderPending(reminder: Pick<DBIssueReminder, 'remindAt'>, now = Date.now()) {
  return new Date(reminder.remindAt).getTime() > now;
}

/**
 * The viewer's pending reminders: an ordinary synced entity pool, fed by
 * bootstrap, delta and the WebSocket like every other store. The server only
 * ever ships the viewer's own rows (`dropForeignUserRows`), and the sync manager
 * re-checks `userId` as defence in depth.
 *
 * Optimistic writes live in the same pool under a temporary id
 * (`OPTIMISTIC_REMINDER_PREFIX + issueId`); the confirmed row replaces it
 * because a pool holds at most one reminder per issue.
 */
export class IssueReminderStore {
  pool = new Map<string, DBIssueReminder>();

  constructor() {
    makeObservable(this, {
      all: computed,
      applySyncAction: action,
      clearForIssue: action,
      pool: observable,
      replaceAll: action,
      setOptimistic: action,
      upsertMany: action,
    });
  }

  get all(): DBIssueReminder[] {
    return Array.from(this.pool.values()).sort((a, b) => a.remindAt.localeCompare(b.remindAt));
  }

  findById(id: string): DBIssueReminder | null {
    return this.pool.get(id) ?? null;
  }

  /** The viewer's reminder on `issueId`, pending or not (callers apply `isReminderPending`). */
  forIssue(issueId: string): DBIssueReminder | null {
    for (const r of this.pool.values()) {
      if (r.issueId === issueId) {
        return r;
      }
    }
    return null;
  }

  /** An authoritative load (bootstrap): the pool becomes exactly `rows`. */
  replaceAll(rows: DBIssueReminder[]) {
    this.pool.clear();
    this.upsertMany(rows);
  }

  upsertMany(rows: DBIssueReminder[]) {
    for (const r of rows) {
      this.setOne(r);
    }
  }

  /**
   * Show a reminder immediately, before the server has confirmed it. Keeps the
   * existing row's id when there is one so a server `U` for it lands on the
   * same entry. Returns what was there so a failure can restore it.
   */
  setOptimistic(
    issueId: string,
    remindAt: string,
    ids: { organizationId: string; userId: string },
  ): DBIssueReminder | null {
    const prev = this.forIssue(issueId);
    const now = new Date().toISOString();
    this.setOne({
      createdAt: prev?.createdAt ?? now,
      id: prev?.id ?? `${OPTIMISTIC_REMINDER_PREFIX}${issueId}`,
      issueId,
      organizationId: ids.organizationId,
      remindAt,
      updatedAt: now,
      userId: ids.userId,
    });
    return prev;
  }

  /** Remove the reminder on `issueId` locally; returns the removed row. */
  clearForIssue(issueId: string): DBIssueReminder | null {
    const prev = this.forIssue(issueId);
    if (prev) {
      this.pool.delete(prev.id);
    }
    return prev;
  }

  applySyncAction(actionType: string, id: string, data: DBIssueReminder | null) {
    if (data && (actionType === 'I' || actionType === 'U' || actionType === 'A')) {
      this.setOne({ ...data, id });
      return;
    }
    applyPoolSyncAction(this.pool, actionType, id, data);
  }

  /** One reminder per issue: a row for the same issue under another id is replaced. */
  private setOne(row: DBIssueReminder) {
    for (const [id, existing] of this.pool) {
      if (existing.issueId === row.issueId && id !== row.id) {
        this.pool.delete(id);
      }
    }
    this.pool.set(row.id, row);
  }
}
