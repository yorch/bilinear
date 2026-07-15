import { type DBPendingTransaction, db } from './db';
import { gql } from './graphql';
import { createClientLogger } from './logger';

const log = createClientLogger('TransactionQueue');

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
// Delay between retries of a transport/network failure (offline, fetch
// rejection, 5xx/429). Deliberately NOT part of RETRY_DELAYS_MS / MAX_RETRIES
// — these failures must never count toward the permanent-drop budget, so
// they get their own fixed backoff instead of an escalating, budget-limited
// one. See `isTransportFailure`.
const TRANSIENT_RETRY_DELAY_MS = 5_000;

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
// Notified whenever the queue's contents change (enqueue, drain, drop) so
// `usePending()` can re-render rows with an in-flight write indicator.
const queueListeners = new Set<() => void>();
// Cached so getPendingIds() returns a stable reference between changes —
// useSyncExternalStore requires this to avoid re-rendering every commit.
let cachedPendingIds: Set<string> | null = null;

function notifyQueueChanged(): void {
  cachedPendingIds = null;
  for (const listener of queueListeners) {
    listener();
  }
}

/** Pull every string id referenced by a transaction's variables (`id` or `ids`). */
function idsFromVariables(variables: Record<string, unknown>): string[] {
  const ids: string[] = [];
  if (typeof variables.id === 'string') {
    ids.push(variables.id);
  }
  if (Array.isArray(variables.ids)) {
    for (const v of variables.ids) {
      if (typeof v === 'string') {
        ids.push(v);
      }
    }
  }
  return ids;
}
// Fallback error surface for permanent failures with no per-call onError —
// rehydrated transactions (callbacks don't survive reload) and enqueue sites
// that omit callbacks would otherwise fail silently. Registered by
// SyncProvider so the message can be localized.
let defaultErrorHandler: ((err: Error) => void) | null = null;

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
      log.warn('enqueue before setActiveSession');
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
    notifyQueueChanged();
    void persist(tx).then(() => {
      void processNext();
    });
    return tx.id;
  }

  static setActiveSession(session: ActiveSession): void {
    activeSession = session;
  }

  /**
   * Ids (from `variables.id` or `variables.ids`) currently in the queue —
   * i.e. rows with an unconfirmed optimistic write. Used to render a
   * pending-write indicator; a false negative (mutation shapes that don't
   * carry `id`/`ids`) just means no dot, never a stuck one.
   */
  static getPendingIds(): Set<string> {
    if (!cachedPendingIds) {
      cachedPendingIds = new Set<string>();
      for (const tx of queue) {
        for (const id of idsFromVariables(tx.variables)) {
          cachedPendingIds.add(id);
        }
      }
    }
    return cachedPendingIds;
  }

  /** Subscribe to queue-content changes (enqueue, drain, drop). Returns an unsubscribe fn. */
  static subscribe(listener: () => void): () => void {
    queueListeners.add(listener);
    return () => {
      queueListeners.delete(listener);
    };
  }

  /** Register the fallback surface for permanent failures without onError. */
  static setDefaultErrorHandler(handler: ((err: Error) => void) | null): void {
    defaultErrorHandler = handler;
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
      log.warn('Hydrate failed', err);
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
        log.warn('Stale-row cleanup failed', err);
      }
    }
    if (queue.length > 0) {
      notifyQueueChanged();
      void processNext();
    }
  }

  /** Test-only: reset singleton state. */
  static __reset() {
    queue.length = 0;
    callbackMap.clear();
    queueListeners.clear();
    cachedPendingIds = null;
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
    log.warn('Persist failed', err);
  }
}

async function unpersist(id: string): Promise<void> {
  try {
    await db.pendingTransactions.delete(id);
  } catch (err) {
    log.warn('Unpersist failed', err);
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * True for failures that reflect a transport/connectivity problem rather
 * than a genuine application-level rejection of this specific mutation:
 * the browser is offline, `fetch` itself rejected (network unreachable —
 * surfaces as a `TypeError` in every major browser, e.g. "Failed to
 * fetch"/"NetworkError when attempting to fetch resource"/"Load failed"),
 * or the server responded with a transient status (5xx, 429).
 *
 * These must NEVER count toward the permanent-failure budget — an
 * offline (or flaky-network) user's edits must never be silently dropped.
 * Genuine GraphQL errors are already flagged `permanent: true` where
 * they're thrown (see `processNext`) and are excluded here so they still
 * go through the normal retry-then-permanent path.
 */
function isTransportFailure(error: Error & { permanent?: boolean }): boolean {
  if (error.permanent) {
    return false;
  }
  if (isOffline()) {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  const message = error.message ?? '';
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(message)) {
    return true;
  }
  const statusMatch = /GraphQL request failed: (\d{3})/.exec(message);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status === 429 || status >= 500;
  }
  return false;
}

// Re-kick the drain the moment the browser reports connectivity back.
// Registered once at module scope (guarded for SSR/non-DOM) rather than
// per-instance so multiple `TransactionQueue` mounts never accumulate
// duplicate 'online' listeners — every instance shares this one module-
// scoped queue/drain loop anyway.
let onlineListenerRegistered = false;
function ensureOnlineListenerRegistered(): void {
  if (onlineListenerRegistered || typeof window === 'undefined') {
    return;
  }
  onlineListenerRegistered = true;
  window.addEventListener('online', () => {
    void processNext();
  });
}

async function processNext(): Promise<void> {
  if (processing || queue.length === 0) {
    return;
  }
  ensureOnlineListenerRegistered();
  if (isOffline()) {
    // Don't burn a doomed-to-fail fetch while the browser reports us
    // offline — stay paused. The 'online' listener above re-kicks the
    // drain the moment connectivity returns.
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
    notifyQueueChanged();
    await unpersist(tx.id);
    const cb = callbackMap.get(tx.id);
    callbackMap.delete(tx.id);
    processing = false;
    // The server mutation already succeeded — everything past this point
    // is best-effort notification. Run onSuccess in its own try/catch,
    // OUTSIDE the block that guards the network call: onSuccess typically
    // runs MobX mutations that can throw, and if that exception propagated
    // into the outer catch below, it would be misclassified as a failed
    // mutation — bumping retryCount and re-persisting an already-succeeded
    // tx, which `hydrate()` would then replay as a duplicate server
    // mutation on the next reload.
    try {
      cb?.onSuccess?.(result.data);
    } catch (err) {
      log.error('onSuccess callback threw after a successful mutation; not retrying', err);
    }
    if (queue.length > 0) {
      void processNext();
    }
    return;
  } catch (err) {
    const error = err as Error & { permanent?: boolean };

    if (isTransportFailure(error)) {
      // Network/offline failure: never counts toward the permanent-drop
      // budget and never rolls back — the write is still valid, just
      // undeliverable right now. `retryCount` (and the persisted row) are
      // left untouched so a later genuine application error still gets
      // its full retry budget.
      if (isOffline()) {
        // Fully pause; resume is driven by the 'online' listener above.
        processing = false;
        return;
      }
      // Online but the transport/server hiccuped (5xx/429/TypeError) —
      // retry the same transaction after a short fixed delay instead of
      // spinning, and instead of ever declaring it permanent. Keep
      // `processing` true across the delay (matching the genuine-error
      // backoff below) so a stray 'online'/enqueue can't start a second
      // attempt concurrently.
      await sleep(TRANSIENT_RETRY_DELAY_MS);
      processing = false;
      if (queue.length > 0) {
        void processNext();
      }
      return;
    }

    const isPermanent = error.permanent || tx.retryCount >= MAX_RETRIES;

    if (isPermanent) {
      queue.shift();
      notifyQueueChanged();
      await unpersist(tx.id);
      const cb = callbackMap.get(tx.id);
      callbackMap.delete(tx.id);
      processing = false;
      if (cb?.onError) {
        cb.onError(error);
      } else {
        defaultErrorHandler?.(error);
      }
    } else {
      tx.retryCount++;
      // Persist the bumped count for same-session continuity. `hydrate()`
      // resets to 0 on reload — see its docstring for the rationale.
      await persist(tx);
      const delay = RETRY_DELAYS_MS[tx.retryCount - 1] ?? 10_000;
      await sleep(delay);
      processing = false;
    }
    if (queue.length > 0) {
      void processNext();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
