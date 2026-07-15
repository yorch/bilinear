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

  // FIX 1 regression test: a transport/network failure (fetch rejecting with
  // a TypeError, as browsers do when offline or unreachable) must never
  // count toward the permanent-failure budget, even after several attempts —
  // it must keep retrying instead of dropping the write and rolling back.
  it('never classifies a transport failure as permanent, and recovers once the network returns', async () => {
    vi.useFakeTimers();
    gqlMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: { ok: true } });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });

    // Give enough fake time for both transient-failure retries to fire and
    // the third (successful) attempt to complete.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
    expect(gqlMock).toHaveBeenCalledTimes(3);
  });

  // A 5xx response is a transient server condition, not a rejection of this
  // specific mutation — same non-permanent treatment as a network failure.
  it('never classifies a 5xx response as permanent', async () => {
    vi.useFakeTimers();
    gqlMock
      .mockRejectedValueOnce(new Error('GraphQL request failed: 503 Service Unavailable'))
      .mockResolvedValueOnce({ data: { ok: true } });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const queue = new TransactionQueue();
    queue.enqueue('mutation X { x }', {}, { onError, onSuccess });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({ ok: true });
  });
});
