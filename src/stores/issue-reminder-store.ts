import { action, makeObservable, observable } from 'mobx';

export interface IssueReminderRow {
  id: string;
  issueId: string;
  remindAt: string;
}

/**
 * The viewer's pending reminders, keyed by issue id. Unlike most pools this one
 * is NOT fed by sync: reminders are private to their owner and SyncActions
 * broadcast org-wide, so `useIssueReminders` fills it from `myIssueReminders`
 * and patches it from each mutation payload. `RootStore.clearEntityPools()`
 * empties it on re-bootstrap like any other pool (the next consumer reloads).
 */
export class IssueReminderStore {
  pool = new Map<string, IssueReminderRow>();
  /** When the last `myIssueReminders` fetch was applied (ms); 0 = never. */
  fetchedAt = 0;

  constructor() {
    makeObservable(this, {
      fetchedAt: observable,
      pool: observable,
      remove: action,
      replaceAll: action,
      setFetchedAt: action,
      upsert: action,
    });
  }

  forIssue(issueId: string): IssueReminderRow | null {
    return this.pool.get(issueId) ?? null;
  }

  upsert(row: IssueReminderRow) {
    this.pool.set(row.issueId, row);
  }

  remove(issueId: string) {
    this.pool.delete(issueId);
  }

  setFetchedAt(ms: number) {
    this.fetchedAt = ms;
  }

  replaceAll(rows: IssueReminderRow[]) {
    this.pool.clear();
    for (const r of rows) {
      this.pool.set(r.issueId, r);
    }
    this.fetchedAt = Date.now();
  }
}
