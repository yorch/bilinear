import { type DBPendingTransaction, db } from './db';
import { gql } from './graphql';

export interface Transaction {
  createdAt: number;
  id: string;
  mutation: string;
  retryCount: number;
  variables: Record<string, unknown>;
}

interface Callbacks {
  onError?: (err: Error) => void;
  onSuccess?: (result: unknown) => void;
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

/**
 * Queues GraphQL mutations and processes them serially with IndexedDB
 * persistence. On permanent failure, calls onError so the caller can roll back
 * optimistic changes.
 */
export class TransactionQueue {
  enqueue(mutation: string, variables: Record<string, unknown>, callbacks?: Callbacks): string {
    const tx: Transaction = {
      createdAt: Date.now(),
      id: crypto.randomUUID(),
      mutation,
      retryCount: 0,
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

  /**
   * Load any pending transactions from IndexedDB (carried over from a previous
   * session) and resume draining. Idempotent — safe to call multiple times.
   * Should be invoked once at app boot, after the user is authenticated.
   */
  static async hydrate(): Promise<void> {
    if (hydrated) {
      return;
    }
    hydrated = true;
    let pending: DBPendingTransaction[];
    try {
      pending = await db.pendingTransactions.orderBy('createdAt').toArray();
    } catch (err) {
      // Dexie not ready (or the table doesn't exist yet on a stale schema) —
      // nothing to hydrate. Future enqueues will work normally once the user
      // performs a write.
      console.warn('[TransactionQueue] Hydrate failed:', err);
      return;
    }
    for (const row of pending) {
      // Reset retry count on hydrate. Reload typically means the user came
      // back later; the network may now be fine, so give a fresh budget.
      // Skip transactions already queued in-memory (StrictMode double-mount).
      if (queue.some(t => t.id === row.id)) {
        continue;
      }
      queue.push({
        createdAt: row.createdAt,
        id: row.id,
        mutation: row.mutation,
        retryCount: 0,
        variables: row.variables,
      });
    }
    if (queue.length > 0) {
      void processNext();
    }
  }

  /** Test-only: reset singleton state. Not used in production. */
  static __reset() {
    queue.length = 0;
    callbackMap.clear();
    processing = false;
    hydrated = false;
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
      // Persist updated retry count so a reload during the retry window
      // resumes from the correct attempt.
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
