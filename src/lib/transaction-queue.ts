import { type DBPendingTransaction, db } from './db';
import { gql } from './graphql';

export interface Transaction {
  createdAt: number;
  id: string;
  mutation: string;
  orgId: string;
  retryCount: number;
  userId: string;
  variables: Record<string, unknown>;
}

interface Callbacks {
  onError?: (err: Error) => void;
  onSuccess?: (result: unknown) => void;
}

interface ActiveSession {
  orgId: string;
  userId: string;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000];

/**
 * Module-scoped singleton state. All `TransactionQueue` instances share the
 * same in-memory FIFO and IndexedDB-persisted backing store. Each enqueue
 * writes to IndexedDB before processing so a page reload (or crash) preserves
 * the pending mutations; `hydrate()` (called once at app boot) re-loads them
 * and resumes draining.
 *
 * Persisted rows carry the `orgId`/`userId` they were enqueued under.
 * `hydrate()` filters to the active session so a sign-out + sign-in on the
 * same browser never replays the previous user's mutations under the new
 * user's auth cookies. Rows from other sessions are deleted on hydrate.
 *
 * Callbacks live in-memory only — they hold component-scoped closures
 * (`optimisticUpdate` rollback, toast on error) that don't survive a reload.
 * Re-hydrated transactions are processed without callbacks; on permanent
 * failure they're logged and dropped. The optimistic store mutation already
 * persisted to IndexedDB will reconcile via the WebSocket SyncAction stream
 * when the server confirms (or be corrected on the next deltaSync if it
 * doesn't).
 */
const queue: Transaction[] = [];
const callbackMap = new Map<string, Callbacks>();
let processing = false;
let hydrated = false;
let activeSession: ActiveSession | null = null;

/**
 * Queues GraphQL mutations and processes them serially with IndexedDB
 * persistence. On permanent failure, calls onError so the caller can roll back
 * optimistic changes.
 */
export class TransactionQueue {
  enqueue(mutation: string, variables: Record<string, unknown>, callbacks?: Callbacks): string {
    if (!activeSession) {
      // Pre-launch we can't reliably guarantee setActiveSession ran before
      // every component's first enqueue (auth flow has a few async hops).
      // Stamp the row with empty IDs and let `hydrate()` skip it on the
      // next boot — better than crashing the page on a race.
      console.warn('[TransactionQueue] enqueue before setActiveSession');
    }
    const tx: Transaction = {
      createdAt: Date.now(),
      id: crypto.randomUUID(),
      mutation,
      orgId: activeSession?.orgId ?? '',
      retryCount: 0,
      userId: activeSession?.userId ?? '',
      variables,
    };
    queue.push(tx);
    if (callbacks) {
      callbackMap.set(tx.id, callbacks);
    }
    void persist(tx).then(() => {
      void processNext();
    });
    return tx.id;
  }

  static setActiveSession(session: ActiveSession): void {
    activeSession = session;
  }

  /**
   * Drop the active session reference. Call on logout so subsequent
   * enqueues can't stamp transactions with the previous user's IDs in the
   * window between sign-out and a page navigation.
   */
  static clearActiveSession(): void {
    activeSession = null;
    // Also flush in-memory pending callbacks; they reference the old
    // session's component closures which are about to unmount.
    callbackMap.clear();
  }

  /**
   * Load pending transactions from IndexedDB (carried over from a previous
   * session) and resume draining. Filters to the active session via the
   * compound `[orgId+userId]` index; rows from other users/orgs are
   * deleted instead of replayed. Idempotent on success; transient Dexie
   * failures leave `hydrated` clear so a later boot can retry.
   */
  static async hydrate(session: ActiveSession): Promise<void> {
    if (hydrated) {
      return;
    }
    let mine: DBPendingTransaction[];
    let foreign: DBPendingTransaction[];
    try {
      [mine, foreign] = await Promise.all([
        db.pendingTransactions
          .where('[orgId+userId]')
          .equals([session.orgId, session.userId])
          .sortBy('createdAt'),
        db.pendingTransactions
          .where('[orgId+userId]')
          .notEqual([session.orgId, session.userId])
          .toArray(),
      ]);
    } catch (err) {
      console.warn('[TransactionQueue] Hydrate failed:', err);
      return;
    }
    hydrated = true;

    for (const row of mine) {
      // StrictMode double-mount can hydrate twice in quick succession; skip
      // rows already in-memory.
      if (queue.some(t => t.id === row.id)) {
        continue;
      }
      // Reset retry count: a reload typically means a long gap during which
      // the network may have recovered, so give a fresh budget.
      queue.push({ ...row, retryCount: 0 });
    }
    if (foreign.length > 0) {
      try {
        await db.pendingTransactions.bulkDelete(foreign.map(r => r.id));
      } catch (err) {
        console.warn('[TransactionQueue] Stale-row cleanup failed:', err);
      }
    }
    if (queue.length > 0) {
      void processNext();
    }
  }

  /** Test-only: reset singleton state. */
  static __reset() {
    queue.length = 0;
    callbackMap.clear();
    processing = false;
    hydrated = false;
    activeSession = null;
  }
}

async function persist(tx: Transaction): Promise<void> {
  try {
    await db.pendingTransactions.put(tx);
  } catch (err) {
    // If IndexedDB is unavailable (private browsing quota, schema mismatch),
    // fall through and process from memory only. Reload-survival is lost but
    // the in-flight retry loop still works.
    console.warn('[TransactionQueue] Persist failed:', err);
  }
}

async function unpersist(id: string): Promise<void> {
  try {
    await db.pendingTransactions.delete(id);
  } catch (err) {
    console.warn('[TransactionQueue] Unpersist failed:', err);
  }
}

async function processNext(): Promise<void> {
  if (processing || queue.length === 0) {
    return;
  }
  processing = true;

  const tx = queue[0];
  try {
    const result = await gql(tx.mutation, tx.variables);
    if (result.errors?.length) {
      const firstError = result.errors[0] as { message: string };
      throw Object.assign(new Error(firstError.message), {
        permanent: true,
      });
    }
    // Signal a successful drain so SyncManager can schedule a delta-sync
    // catch-up past the server's commit-watermark window. Without this,
    // a mutation that drains while WS is in the middle of its handshake
    // can land in the Redis broadcast gap (pub/sub has no replay) and
    // the just-emitted SyncAction is invisible to this client until the
    // next WS push. Best-effort: skip on SSR / non-DOM environments.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bilinear:transaction-drained'));
    }
    queue.shift();
    await unpersist(tx.id);
    const cb = callbackMap.get(tx.id);
    callbackMap.delete(tx.id);
    cb?.onSuccess?.(result.data);
  } catch (err) {
    const error = err as Error & { permanent?: boolean };
    const isPermanent = error.permanent || tx.retryCount >= MAX_RETRIES;

    if (isPermanent) {
      queue.shift();
      await unpersist(tx.id);
      const cb = callbackMap.get(tx.id);
      callbackMap.delete(tx.id);
      cb?.onError?.(error);
    } else {
      tx.retryCount++;
      // Persist the bumped count for same-session continuity. `hydrate()`
      // resets to 0 on reload — see its docstring for the rationale.
      await persist(tx);
      const delay = RETRY_DELAYS_MS[tx.retryCount - 1] ?? 10_000;
      await sleep(delay);
    }
  } finally {
    processing = false;
    if (queue.length > 0) {
      void processNext();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
