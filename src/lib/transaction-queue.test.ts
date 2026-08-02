import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransactionQueue } from './transaction-queue';

// `db` is Dexie-backed (IndexedDB) — unavailable in the node test
// environment, so we mock only the surface `transaction-queue.ts` touches.
const dbMocks = {
  delete: vi.fn().mockResolvedValue(undefined),
  put: vi.fn().mockResolvedValue(undefined),
};
vi.mock('./db', () => ({
  db: {
    pendingTransactions: {
      bulkDelete: vi.fn().mockResolvedValue(undefined),
      delete: (...args: unknown[]) => dbMocks.delete(...args),
      put: (...args: unknown[]) => dbMocks.put(...args),
      where: () => ({
        equals: () => ({ sortBy: async () => [] }),
        notEqual: () => ({ toArray: async () => [] }),
      }),
    },
  },
}));

const gqlMock = vi.fn();
vi.mock('./graphql', () => ({
  gql: (...args: unknown[]) => gqlMock(...args),
}));

vi.mock('./logger', () => ({
  createClientLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

/** Flush pending microtask chains without relying on fake timers. */
function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('TransactionQueue', () => {
  beforeEach(() => {
    TransactionQueue.__reset();
    TransactionQueue.setActiveSession({ orgId: 'org-1', userId: 'user-1' });
    TransactionQueue.setDefaultErrorHandler(null);
    gqlMock.mockReset();
    dbMocks.put.mockClear();
    dbMocks.delete.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drains successfully and invokes onSuccess with the mutation result', async () => {
    gqlMock.mockResolvedValue({ data: { issue: { id: '1' } } });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(onSuccess).toHaveBeenCalledWith({ issue: { id: '1' } });
    expect(onError).not.toHaveBeenCalled();
    expect(TransactionQueue.getPendingIds().size).toBe(0);
    expect(dbMocks.delete).toHaveBeenCalledTimes(1);
  });

  it('treats GraphQL application errors as permanent: drops the tx and calls onError', async () => {
    gqlMock.mockResolvedValue({ errors: [{ message: 'validation failed' }] });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('validation failed');
    expect(TransactionQueue.getPendingIds().size).toBe(0);
  });

  // FIX 2 regression test: an onSuccess callback that throws (e.g. a MobX
  // mutation blowing up) must never cause the already-succeeded mutation to
  // be re-persisted or reported as failed — that would make hydrate() replay
  // it as a duplicate write on the next reload.
  it('does not re-persist or report an error when onSuccess throws after a successful drain', async () => {
    gqlMock.mockResolvedValue({ data: { ok: true } });
    const onSuccess = vi.fn(() => {
      throw new Error('boom in a MobX reaction');
    });
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });
    await flushMicrotasks();
    await flushMicrotasks();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    // One put() from the initial enqueue, and exactly one delete() from the
    // successful drain — no second put() re-persisting a "failed" attempt.
    expect(dbMocks.put).toHaveBeenCalledTimes(1);
    expect(dbMocks.delete).toHaveBeenCalledTimes(1);
    expect(TransactionQueue.getPendingIds().size).toBe(0);
  });

  // FIX 1 regression test: while the browser genuinely reports itself
  // offline, a queued mutation must pause indefinitely — never even attempt
  // the network call, never count toward the permanent-failure budget, and
  // never roll back — then resume and drain normally once connectivity
  // (`navigator.onLine`) returns.
  it('pauses indefinitely without counting toward retries while offline, and resumes once back online', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: false });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', { id: 'issue-1' }, { onError, onSuccess });

    await vi.advanceTimersByTimeAsync(30_000);

    // Paused before ever attempting the mutation: nothing to classify as
    // permanent, so no retry-count bump, no rollback, no error surfaced.
    expect(gqlMock).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(dbMocks.delete).not.toHaveBeenCalled();
    expect(TransactionQueue.getPendingIds()).toEqual(new Set(['issue-1']));

    // Connectivity returns. This Node test environment has no `window`, so
    // the module's real 'online' DOM listener never fires here — but any
    // enqueue re-kicks the shared drain loop, which re-checks `isOffline()`
    // and proceeds to drain the still-queued transaction at the FIFO head,
    // the same recovery path a real 'online' event would trigger.
    vi.stubGlobal('navigator', { onLine: true });
    gqlMock.mockResolvedValue({ data: { ok: true } });
    new TransactionQueue().enqueue('mutation Y { y }', {}, {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
    expect(onError).not.toHaveBeenCalled();
  });

  // FIX 1 regression test: a persistent 5xx response is a real (if
  // hopefully transient) condition on a reachable server, not proof the
  // user is offline — it must NOT retry forever. It counts toward
  // MAX_RETRIES like any other error and eventually becomes permanent,
  // rolling back and unblocking the queue instead of stalling it forever.
  it('a persistent 5xx response while online eventually becomes permanent and rolls back', async () => {
    vi.useFakeTimers();
    gqlMock.mockRejectedValue(new Error('GraphQL request failed: 503 Service Unavailable'));
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });

    // RETRY_DELAYS_MS = [1_000, 3_000, 10_000] — enough fake time for all
    // MAX_RETRIES (3) retries plus the initial attempt to play out.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toMatch(/503/);
    // Initial attempt + 3 retries = 4 total calls before giving up.
    expect(gqlMock).toHaveBeenCalledTimes(4);
    expect(TransactionQueue.getPendingIds().size).toBe(0);
    expect(dbMocks.delete).toHaveBeenCalledTimes(1);
  });

  // A genuine network-unreachable rejection (TypeError, as browsers throw
  // when a fetch can't even reach the network) that resolves within the
  // normal retry budget still succeeds — this is the ordinary bounded-retry
  // path, not the offline-pause path (the browser never reported itself
  // offline here), and it must not be short-circuited by FIX 1's changes.
  it('recovers from a transient fetch rejection within the retry budget', async () => {
    vi.useFakeTimers();
    gqlMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: { ok: true } });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
    expect(gqlMock).toHaveBeenCalledTimes(3);
  });

  // §1.5: a RATELIMITED GraphQL error is the one application error the server
  // explicitly says to retry. Unlike FORBIDDEN/NOT_FOUND/BAD_USER_INPUT (which
  // stay permanent and drop immediately), it must go through the bounded retry
  // path — otherwise the mutation silently vanishes with its optimistic state
  // never confirmed nor rolled back.
  it('retries a RATELIMITED error instead of dropping it, and succeeds on retry', async () => {
    vi.useFakeTimers();
    gqlMock
      .mockResolvedValueOnce({ errors: [{ extensions: { code: 'RATELIMITED' }, message: 'slow down' }] })
      .mockResolvedValueOnce({ errors: [{ extensions: { code: 'RATELIMITED' }, message: 'slow down' }] })
      .mockResolvedValueOnce({ data: { ok: true } });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
    expect(gqlMock).toHaveBeenCalledTimes(3);
  });

  it('gives up on a persistently RATELIMITED mutation after MAX_RETRIES', async () => {
    vi.useFakeTimers();
    gqlMock.mockResolvedValue({
      errors: [{ extensions: { code: 'RATELIMITED' }, message: 'slow down' }],
    });
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError });

    await vi.advanceTimersByTimeAsync(60_000);

    // Initial attempt + 3 retries, then permanent.
    expect(gqlMock).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(TransactionQueue.getPendingIds().size).toBe(0);
  });

  it('drops a FORBIDDEN error immediately with no retry', async () => {
    vi.useFakeTimers();
    gqlMock.mockResolvedValue({
      errors: [{ extensions: { code: 'FORBIDDEN' }, message: 'nope' }],
    });
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(gqlMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
