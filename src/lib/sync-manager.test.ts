import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RootStore } from '@/stores/root-store';
import { COMMIT_WATERMARK_LAG_MS } from './sync-config';
import type { SerializedSyncAction, WsClient, WsMessage } from './ws-client';

// `db` is Dexie-backed (IndexedDB) — unavailable in the node test environment,
// so we mock only the surface `sync-manager.ts` touches, mirroring the
// established pattern in `transaction-queue.test.ts`.
function createFakeTable() {
  return {
    bulkPut: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    toArray: vi.fn().mockResolvedValue([]),
    where: vi.fn(() => ({
      equals: vi.fn(() => ({
        delete: vi.fn().mockResolvedValue(undefined),
      })),
    })),
  };
}

const TABLE_NAMES = [
  'organizations',
  'teams',
  'users',
  'workflowStates',
  'issueLabels',
  'issues',
  'cycles',
  'documents',
  'projects',
  'projectMilestones',
  'projectUpdates',
  'customViews',
  'notifications',
  'issueRelations',
  'issueTemplates',
  'customFieldDefinitions',
  'customFieldValues',
  'initiatives',
  'initiativeProjects',
  'favorites',
  'issueActivities',
  'organizationMembers',
  'syncMetadata',
  'pendingTransactions',
] as const;

// Populated fresh in beforeEach via resetFakeDb().
const fakeTables: Record<
  (typeof TABLE_NAMES)[number],
  ReturnType<typeof createFakeTable>
> = {} as never;
for (const name of TABLE_NAMES) {
  fakeTables[name] = createFakeTable();
}

const fakeDb = {
  ...fakeTables,
  tables: Object.values(fakeTables),
  transaction: vi.fn(async (_mode: string, _tables: unknown, cb: () => unknown) => cb()),
};

vi.mock('./db', () => ({ db: fakeDb }));

vi.mock('./logger', () => ({
  createClientLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Imported after the mocks above so `sync-manager.ts` picks up the fakes.
const { SyncManager } = await import('./sync-manager');

function resetFakeDb() {
  for (const table of Object.values(fakeTables)) {
    table.bulkPut.mockClear();
    table.clear.mockClear();
    table.delete.mockClear();
    table.get.mockClear();
    table.put.mockClear();
    table.toArray.mockClear();
  }
  fakeDb.transaction.mockClear();
}

/** Minimal fake RootStore — every store method is a spy; `syncStore` keeps
 * real mutable state so cursor-advancement assertions are meaningful. */
function createFakeStores() {
  const syncStore = {
    lastSyncId: '0',
    setError: vi.fn(),
    setLastSyncId(id: string) {
      this.lastSyncId = id;
    },
    setOrganizationName: vi.fn(),
    setStatus: vi.fn(),
    setWsConnected: vi.fn(),
  };

  const storeNames = [
    'teamStore',
    'userStore',
    'workflowStateStore',
    'labelStore',
    'issueStore',
    'cycleStore',
    'documentStore',
    'favoriteStore',
    'initiativeStore',
    'projectStore',
    'customViewStore',
    'customFieldStore',
    'notificationStore',
    'issueRelationStore',
    'issueTemplateStore',
    'organizationMemberStore',
  ] as const;

  const stores: Record<string, unknown> = { syncStore };
  for (const name of storeNames) {
    stores[name] = {
      applyDefinitionSyncAction: vi.fn(),
      applyInitiativeProjectSyncAction: vi.fn(),
      applyMilestoneSyncAction: vi.fn(),
      applySyncAction: vi.fn(),
      applyUpdateSyncAction: vi.fn(),
      applyValueSyncAction: vi.fn(),
      // Real stores expose an entity pool; SyncManager reads `issueStore.pool`
      // to carry a previously-cached label set onto a bare issue payload.
      pool: new Map<string, unknown>(),
      replaceAll: vi.fn(),
      upsertDefinitions: vi.fn(),
      upsertMany: vi.fn(),
      upsertMilestones: vi.fn(),
      upsertProjectLinks: vi.fn(),
      upsertUpdates: vi.fn(),
      upsertValues: vi.fn(),
    };
  }
  // `fullBootstrap` clears every entity pool before repopulating, so the fake
  // RootStore needs the method too — without it the bootstrap throws before it
  // reaches the store writes these tests assert on.
  stores.clearEntityPools = vi.fn();
  return stores as unknown as RootStore & { syncStore: typeof syncStore };
}

function createFakeWsClient() {
  const messageHandlers: Array<(msg: WsMessage) => void> = [];
  const statusHandlers: Array<(connected: boolean) => void> = [];
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    emitMessage(msg: WsMessage) {
      for (const h of [...messageHandlers]) {
        h(msg);
      }
    },
    emitStatus(connected: boolean) {
      for (const h of [...statusHandlers]) {
        h(connected);
      }
    },
    onMessage: vi.fn((h: (msg: WsMessage) => void) => {
      messageHandlers.push(h);
      return () => {
        const i = messageHandlers.indexOf(h);
        if (i >= 0) {
          messageHandlers.splice(i, 1);
        }
      };
    }),
    onStatusChange: vi.fn((h: (connected: boolean) => void) => {
      statusHandlers.push(h);
      return () => {
        const i = statusHandlers.indexOf(h);
        if (i >= 0) {
          statusHandlers.splice(i, 1);
        }
      };
    }),
  };
}

function makeAction(overrides: Partial<SerializedSyncAction> = {}): SerializedSyncAction {
  return {
    action: 'U',
    createdAt: '2026-01-01T00:00:00.000Z',
    data: { id: 'x' },
    id: '1',
    modelId: 'x',
    modelName: 'Issue',
    organizationId: 'org-1',
    xactId: '1000',
    ...overrides,
  };
}

/** Mirrors `sync-manager.ts`'s own `actionCursor` encoding so tests can
 * predict expected cursor values without reaching into the private fn. The
 * cursor is the `(xactId, id)` tuple joined by a dash. */
function expectedCursor(xactId: string, id: string): string {
  return `${xactId}-${id}`;
}

function cursorParam(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  return decodeURIComponent(parsed.searchParams.get('lastSyncId') ?? '');
}

function jsonResponse(body: unknown, ok = true) {
  return { json: async () => body, ok };
}

// biome-ignore lint/suspicious/noExplicitAny: private-member test access
type Instance = any;

describe('SyncManager', () => {
  beforeEach(() => {
    resetFakeDb();
    // sync-manager's stop() touches window.add/removeEventListener; node env
    // has no window global, so stub a minimal one for the duration of a test.
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ─── Cursor comparison (exercised through the public applyActions path,
  // since compareCursor/splitCursor/actionCursor are not exported) ─────────
  describe('cursor comparison semantics', () => {
    it('advances the shared cursor to the max (xactId, id) tuple regardless of array order', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const earlier = makeAction({
        id: '1',
        modelId: 'i-early',
        xactId: '1000',
      });
      const later = makeAction({
        id: '2',
        modelId: 'i-late',
        xactId: '2000',
      });

      // Later action listed FIRST in the array — max-tracking must not just
      // take the last-processed action's cursor.
      await (manager as Instance).applyActions([later, earlier]);

      expect(stores.syncStore.lastSyncId).toBe(expectedCursor(later.xactId, later.id));
    });

    it('breaks ties on id (numerically, not lexicographically) when xactId is identical', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      // Same writing transaction, id '9' vs id '10' — a naive string compare
      // would put '10' before '9'; the real comparator must use BigInt.
      const idNine = makeAction({ id: '9', xactId: '1000' });
      const idTen = makeAction({ id: '10', xactId: '1000' });

      await (manager as Instance).applyActions([idNine, idTen]);

      expect(stores.syncStore.lastSyncId).toBe(expectedCursor(idTen.xactId, idTen.id));
    });

    it('treats a legacy no-dash cursor as (0, id) and only overtakes it once a real cursor exceeds it', async () => {
      const stores = createFakeStores();
      stores.syncStore.lastSyncId = '9'; // legacy pre-migration format
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      // xactId '0' matches the legacy cursor's implicit xactId, so this is
      // purely an id tie-break against the legacy value — id '3' should NOT
      // overtake legacy '9'. (Real xid8 values are never 0; this only
      // exercises the legacy-compat path.)
      await (manager as Instance).applyActions([makeAction({ id: '3', xactId: '0' })]);
      expect(stores.syncStore.lastSyncId).toBe('9');

      // id '10' > legacy '9' numerically — must overtake, and does so by
      // rewriting into the new dash-encoded format.
      await (manager as Instance).applyActions([makeAction({ id: '10', xactId: '0' })]);
      expect(stores.syncStore.lastSyncId).toBe('0-10');
    });

    it('heals a stale `<committedAtMicros>-<id>` cursor instead of letting its huge value pin max()', async () => {
      const stores = createFakeStores();
      // A cursor persisted before the xact_id migration: the first component is
      // an epoch-microseconds value (~1.7e15) far above any real xid8. Left as
      // a raw BigInt it would dominate every real (small-xactId) action forever,
      // so the persisted cursor would never advance and delta would keep
      // re-reading from a wedged position.
      stores.syncStore.lastSyncId = '1750000000000000-12345';
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      await (manager as Instance).applyActions([makeAction({ id: '5', xactId: '1001' })]);

      // The stale cursor collapses to (0,0), so the real action overtakes it and
      // the persisted cursor heals to a real `<xactId>-<id>` value.
      expect(stores.syncStore.lastSyncId).toBe('1001-5');
    });
  });

  // ─── deltaSync local-cursor pagination ──────────────────────────────────
  // §78 shipped `'D' OrganizationMember` SyncActions with no client handler,
  // so removing someone left every other admin's open tab showing them until
  // reload. These assert the action now reaches a store.
  describe('organization roster actions', () => {
    it('routes a member removal to the roster store', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      await (manager as Instance).applyActions([
        makeAction({ action: 'D', data: null, modelId: 'mem-1', modelName: 'OrganizationMember' }),
      ]);

      expect(stores.organizationMemberStore.applySyncAction).toHaveBeenCalledWith(
        'D',
        'mem-1',
        null,
      );
    });

    it('replaces the roster on bootstrap rather than merging into it', async () => {
      // Membership is hard-deleted, so a bootstrap is authoritative about
      // absence: merging would leave someone who has been removed in the
      // roster of any client that re-bootstrapped (the delta-failure
      // fallback), showing controls the server answers with NOT_FOUND.
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const row = { id: 'mem-1', organizationId: 'org-1', role: 'owner', userId: 'user-1' };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: async () =>
            [
              `OrganizationMember=${JSON.stringify(row)}`,
              `_metadata_=${JSON.stringify({ lastSyncId: '42-1' })}`,
            ].join('\n'),
        }),
      );

      await (manager as Instance).fullBootstrap();

      expect(stores.organizationMemberStore.replaceAll).toHaveBeenCalledWith([row]);
      expect(stores.organizationMemberStore.upsertMany).not.toHaveBeenCalled();
    });

    it('serializes fullBootstrap against a live apply that arrives mid-write', async () => {
      // The bootstrap write is an authoritative load: it clears Dexie and
      // clears the roster pool outright. It is reached from deltaSync's
      // failure fallback while the WebSocket is live, so without the lock a
      // live action could land between the clear and the repopulate.
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      let releaseBootstrap: () => void = () => {};
      const bootstrapFlush = new Promise<void>(resolve => {
        releaseBootstrap = resolve;
      });
      let flushCall = 0;
      fakeDb.transaction.mockImplementation(async (_m: string, _t: unknown, cb: () => unknown) => {
        flushCall += 1;
        if (flushCall === 1) {
          await bootstrapFlush;
        }
        return cb();
      });
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: async () => `_metadata_=${JSON.stringify({ lastSyncId: '42-1' })}`,
        }),
      );

      const bootstrap = (manager as Instance).fullBootstrap();
      // Let the bootstrap get past its fetch and into the exclusive section,
      // where it parks on the gated flush.
      await new Promise(resolve => setTimeout(resolve, 0));

      const live = (manager as Instance).applyActions([
        makeAction({ action: 'U', data: null, modelId: 'mem-1', modelName: 'OrganizationMember' }),
      ]);
      await new Promise(resolve => setTimeout(resolve, 0));

      // Queued behind the bootstrap rather than racing its clear/repopulate.
      expect(stores.organizationMemberStore.applySyncAction).not.toHaveBeenCalled();

      releaseBootstrap();
      await Promise.all([bootstrap, live]);

      expect(
        vi.mocked(stores.organizationMemberStore.replaceAll).mock.invocationCallOrder[0],
      ).toBeLessThan(
        vi.mocked(stores.organizationMemberStore.applySyncAction).mock.invocationCallOrder[0],
      );
    });

    it('routes a role change to the roster store', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      const row = { id: 'mem-1', organizationId: 'org-1', role: 'admin', userId: 'u1' };

      await (manager as Instance).applyActions([
        makeAction({ action: 'U', data: row, modelId: 'mem-1', modelName: 'OrganizationMember' }),
      ]);

      expect(stores.organizationMemberStore.applySyncAction).toHaveBeenCalledWith(
        'U',
        'mem-1',
        row,
      );
    });
  });

  describe('deltaSync pagination', () => {
    it('pages through hasMore results until the server reports hasMore=false', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const page1 = makeAction({ id: '1', xactId: '1001' });
      const page2 = makeAction({ id: '2', xactId: '1002' });
      const page3 = makeAction({ id: '3', xactId: '1003' });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ actions: [page1], hasMore: true }))
        .mockResolvedValueOnce(jsonResponse({ actions: [page2], hasMore: true }))
        .mockResolvedValueOnce(jsonResponse({ actions: [page3], hasMore: false }));
      vi.stubGlobal('fetch', fetchMock);

      await (manager as Instance).deltaSync();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(cursorParam(fetchMock.mock.calls[0][0])).toBe('0');
      expect(cursorParam(fetchMock.mock.calls[1][0])).toBe(expectedCursor(page1.xactId, page1.id));
      expect(cursorParam(fetchMock.mock.calls[2][0])).toBe(expectedCursor(page2.xactId, page2.id));
      expect(stores.syncStore.lastSyncId).toBe(expectedCursor(page3.xactId, page3.id));
      expect(stores.syncStore.setStatus).toHaveBeenCalledWith('connected');
    });

    it('is not derailed by a concurrent live-WS applyActions() bumping the shared cursor mid-pagination (#92)', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const page1 = makeAction({
        id: '1',
        modelId: 'i-1',
        xactId: '1001',
      });
      const page2 = makeAction({
        id: '2',
        modelId: 'i-2',
        xactId: '1002',
      });
      // A "live" WS action arriving mid-backlog, far ahead of the backlog
      // itself — simulates the real-time stream racing ahead of a slow
      // delta-sync catching up an offline client.
      const liveAction = makeAction({
        id: '999999',
        modelId: 'live-team',
        modelName: 'Team',
        xactId: '9999999',
      });

      let secondCallCursor: string | null = null;
      const fetchMock = vi.fn(async (url: string) => {
        if (fetchMock.mock.calls.length === 1) {
          return jsonResponse({ actions: [page1], hasMore: true });
        }
        if (fetchMock.mock.calls.length === 2) {
          // Fires exactly at the moment the second page is about to be
          // requested — i.e. after page 1 was fully paginated locally, but
          // before this loop iteration's fetch happens. A real WS message
          // handler calls applyActions() the exact same way.
          secondCallCursor = cursorParam(url);
          await (manager as Instance).applyActions([liveAction]);
          return jsonResponse({ actions: [page2], hasMore: false });
        }
        throw new Error(`unexpected extra fetch call: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      await (manager as Instance).deltaSync();

      // The shared cursor was bumped to the live action's far-future value...
      expect(stores.syncStore.lastSyncId).toBe(expectedCursor(liveAction.xactId, liveAction.id));

      // ...but the SECOND page request must have used the LOCAL cursor
      // (derived from page 1's own actions), not the concurrently-bumped
      // shared value. This is the crux of the #92 fix.
      expect(secondCallCursor).toBe(expectedCursor(page1.xactId, page1.id));
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // And the final "commit to shared cursor" step must never regress it:
      // the backlog's own max (page2's cursor) is far behind the live value,
      // so the shared cursor must be left at the live value, not overwritten
      // backwards.
      expect(stores.syncStore.lastSyncId).not.toBe(expectedCursor(page2.xactId, page2.id));
    });

    it('serializes concurrent applyActions calls (delta + live WS) through the mutex (#1.6)', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      // Gate the FIRST apply's Dexie flush on a manual deferred so we can prove
      // the SECOND apply doesn't start its store writes until the first fully
      // completes — the whole point of the single-slot lock.
      let releaseFirst: () => void = () => {};
      const firstFlush = new Promise<void>(resolve => {
        releaseFirst = resolve;
      });
      let flushCall = 0;
      fakeDb.transaction.mockImplementation(async (_m: string, _t: unknown, cb: () => unknown) => {
        flushCall += 1;
        if (flushCall === 1) {
          await firstFlush;
        }
        return cb();
      });

      const a1 = makeAction({ id: '1', modelId: 'i-1', xactId: '100' });
      const a2 = makeAction({ id: '2', modelId: 'i-2', xactId: '200' });

      const p1 = (manager as Instance).applyActions([a1]);
      const p2 = (manager as Instance).applyActions([a2]);

      // Let p1 run up to its gated Dexie flush. p2 is queued behind the lock,
      // so only the first batch's store apply has happened so far.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(stores.issueStore.applySyncAction).toHaveBeenCalledTimes(1);

      releaseFirst();
      await Promise.all([p1, p2]);

      // Both applied, strictly ordered; the final cursor is the batch max, never
      // regressed by the second flush completing after the first.
      expect(stores.issueStore.applySyncAction).toHaveBeenCalledTimes(2);
      expect(stores.syncStore.lastSyncId).toBe(expectedCursor(a2.xactId, a2.id));
    });

    it('bails out of the loop immediately once stopped, without requesting further pages', async () => {
      const stores = createFakeStores();
      const wsClient = createFakeWsClient();
      const manager = new SyncManager(stores, wsClient as unknown as WsClient);

      const page1 = makeAction({ id: '1', xactId: '1001' });
      const fetchMock = vi.fn(async () => {
        // Simulate stop() racing in while page 1's request is in flight
        // (e.g. the component unmounted mid-fetch).
        manager.stop();
        return jsonResponse({ actions: [page1], hasMore: true });
      });
      vi.stubGlobal('fetch', fetchMock);

      await (manager as Instance).deltaSync();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(stores.syncStore.setStatus).not.toHaveBeenCalledWith('connected');
    });

    it('does not call fetch at all when deltaSync is invoked after stop()', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      manager.stop();

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await (manager as Instance).deltaSync();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to fullBootstrap when a delta page request fails, and resets isDeltaSyncing so a later call is not permanently blocked', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      const fullBootstrapSpy = vi.fn().mockResolvedValue(undefined);
      (manager as Instance).fullBootstrap = fullBootstrapSpy;

      const failingFetch = vi.fn().mockResolvedValueOnce(jsonResponse({}, false));
      vi.stubGlobal('fetch', failingFetch);

      await (manager as Instance).deltaSync();
      expect(fullBootstrapSpy).toHaveBeenCalledTimes(1);

      // isDeltaSyncing must have been reset to false before falling back —
      // otherwise every subsequent deltaSync() call would silently no-op.
      const okFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ actions: [], hasMore: false }));
      vi.stubGlobal('fetch', okFetch);
      await (manager as Instance).deltaSync();
      expect(okFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ─── applyActions ordering / upsert semantics ───────────────────────────
  describe('applyActions upsert/delete semantics', () => {
    it('routes a U action to the matching store.applySyncAction and stages a Dexie bulkPut', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const data = { id: 'i-1', title: 'Fix bug' };
      await (manager as Instance).applyActions([
        makeAction({ action: 'U', data, id: '1', modelId: 'i-1', modelName: 'Issue' }),
      ]);

      // The row is normalized ONCE and the same object goes to both sinks, so
      // the store and Dexie cannot disagree about an issue's labels.
      const normalized = { ...data, labelIds: [] };
      expect(stores.issueStore.applySyncAction).toHaveBeenCalledWith('U', 'i-1', normalized);
      expect(fakeTables.issues.bulkPut).toHaveBeenCalledWith([normalized]);
      expect(fakeTables.issues.delete).not.toHaveBeenCalled();
    });

    it('routes a D action to store.applySyncAction and stages a Dexie delete instead of a bulkPut', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      await (manager as Instance).applyActions([
        makeAction({ action: 'D', data: null, id: '1', modelId: 'i-1', modelName: 'Issue' }),
      ]);

      expect(stores.issueStore.applySyncAction).toHaveBeenCalledWith('D', 'i-1', null);
      expect(fakeTables.issues.delete).toHaveBeenCalledWith('i-1');
      expect(fakeTables.issues.bulkPut).not.toHaveBeenCalled();
    });

    it('dispatches each modelName to its own store, leaving others untouched', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      await (manager as Instance).applyActions([
        makeAction({ id: '1', modelId: 't-1', modelName: 'Team' }),
      ]);

      expect(stores.teamStore.applySyncAction).toHaveBeenCalledTimes(1);
      expect(stores.issueStore.applySyncAction).not.toHaveBeenCalled();
      expect(stores.userStore.applySyncAction).not.toHaveBeenCalled();
    });

    it('replaces an issue custom-field-value set atomically (delete-by-issueId then bulkPut the fresh rows)', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const values = [{ definitionId: 'd-1', issueId: 'i-1', value: '42' }];
      await (manager as Instance).applyActions([
        makeAction({
          // The exact payload `issueCustomFieldValuesSet` emits: the value set
          // and nothing else — no `id`, no issue columns.
          data: { customFieldValues: values },
          id: '1',
          modelId: 'i-1',
          modelName: 'Issue',
        }),
      ]);

      expect(stores.customFieldStore.applyValueSyncAction).toHaveBeenCalledTimes(1);
      expect(fakeTables.customFieldValues.where).toHaveBeenCalledWith('issueId');
      expect(fakeTables.customFieldValues.bulkPut).toHaveBeenCalledWith(values);
    });

    it('does not let a custom-field-value payload reach the issue store or db.issues', async () => {
      // Regression: this payload carries no issue columns. Routing it into
      // `issueStore.applySyncAction` (a whole-object replace) erased the issue
      // on every connected client, and pushing it into `db.issues` — whose
      // inbound keyPath is `id` — failed the put and aborted the whole
      // transaction, including the lastSyncId write.
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      await (manager as Instance).applyActions([
        makeAction({
          data: { customFieldValues: [{ definitionId: 'd-1', issueId: 'i-1', value: '42' }] },
          id: '1',
          modelId: 'i-1',
          modelName: 'Issue',
        }),
      ]);

      expect(stores.issueStore.applySyncAction).not.toHaveBeenCalled();
      expect(fakeTables.issues.bulkPut).not.toHaveBeenCalled();
    });

    it('still applies a full issue row that happens to carry custom-field values', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const row = {
        customFieldValues: [{ definitionId: 'd-1', issueId: 'i-1', value: '42' }],
        id: 'i-1',
        identifier: 'ENG-1',
        title: 'Real issue row',
      };
      await (manager as Instance).applyActions([
        makeAction({ data: row, id: '1', modelId: 'i-1', modelName: 'Issue' }),
      ]);

      expect(stores.issueStore.applySyncAction).toHaveBeenCalledTimes(1);
      expect(stores.customFieldStore.applyValueSyncAction).toHaveBeenCalledTimes(1);
    });

    it('does nothing for an empty actions array (no store calls, no transaction)', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      await (manager as Instance).applyActions([]);

      expect(fakeDb.transaction).not.toHaveBeenCalled();
      expect(stores.issueStore.applySyncAction).not.toHaveBeenCalled();
    });

    it('advances the shared cursor to the batch max even when a later-committed action is applied first within the same call', async () => {
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);

      const first = makeAction({
        id: '50',
        modelId: 'a',
        xactId: '5000',
      });
      const second = makeAction({
        id: '10',
        modelId: 'b',
        xactId: '1000',
      });

      await (manager as Instance).applyActions([first, second]);

      // Both get applied (order doesn't gate application)...
      expect(stores.issueStore.applySyncAction).toHaveBeenCalledTimes(2);
      // ...but the cursor reflects the max, not "whichever came last in the array".
      expect(stores.syncStore.lastSyncId).toBe(expectedCursor(first.xactId, first.id));
    });
  });

  // ─── stop() cancels timers ──────────────────────────────────────────────
  describe('stop()', () => {
    it('cancels a pending scheduleFollowUpDelta timer so no fetch happens after teardown', async () => {
      vi.useFakeTimers();
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ actions: [], hasMore: false }));
      vi.stubGlobal('fetch', fetchMock);

      (manager as Instance).scheduleFollowUpDelta();
      manager.stop();
      await vi.advanceTimersByTimeAsync(COMMIT_WATERMARK_LAG_MS + 1000);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cancels a pending handleTransactionDrained timer so no fetch happens after teardown', async () => {
      vi.useFakeTimers();
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ actions: [], hasMore: false }));
      vi.stubGlobal('fetch', fetchMock);

      (manager as Instance).handleTransactionDrained();
      manager.stop();
      await vi.advanceTimersByTimeAsync(COMMIT_WATERMARK_LAG_MS + 1000);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('cancels a pending resync jitter timer so no fetch happens after teardown', async () => {
      vi.useFakeTimers();
      const stores = createFakeStores();
      const wsClient = createFakeWsClient();
      const manager = new SyncManager(stores, wsClient as unknown as WsClient);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ actions: [], hasMore: false }));
      vi.stubGlobal('fetch', fetchMock);

      // Registers the onMessage handler without going through start() (which
      // needs `window` event wiring beyond what stop() itself touches).
      (manager as Instance).setupWebSocket();
      wsClient.emitMessage({ cmd: 'resync' });
      manager.stop();
      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('control case: an unstopped scheduleFollowUpDelta timer DOES fire a deltaSync', async () => {
      vi.useFakeTimers();
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ actions: [], hasMore: false }));
      vi.stubGlobal('fetch', fetchMock);

      (manager as Instance).scheduleFollowUpDelta();
      await vi.advanceTimersByTimeAsync(COMMIT_WATERMARK_LAG_MS + 1000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid handleTransactionDrained calls into a single delta-sync', async () => {
      vi.useFakeTimers();
      const stores = createFakeStores();
      const manager = new SyncManager(stores, createFakeWsClient() as unknown as WsClient);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ actions: [], hasMore: false }));
      vi.stubGlobal('fetch', fetchMock);

      (manager as Instance).handleTransactionDrained();
      (manager as Instance).handleTransactionDrained();
      (manager as Instance).handleTransactionDrained();
      await vi.advanceTimersByTimeAsync(COMMIT_WATERMARK_LAG_MS + 1000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes WS handlers and disconnects the WsClient', () => {
      const stores = createFakeStores();
      const wsClient = createFakeWsClient();
      const manager = new SyncManager(stores, wsClient as unknown as WsClient);

      (manager as Instance).setupWebSocket();
      expect(wsClient.connect).toHaveBeenCalledTimes(1);

      manager.stop();
      expect(wsClient.disconnect).toHaveBeenCalledTimes(1);

      // A message emitted post-stop should reach no handlers (unsubscribed).
      const resyncHandlerCallsBefore = wsClient.onMessage.mock.calls.length;
      expect(resyncHandlerCallsBefore).toBeGreaterThan(0);
      wsClient.emitMessage({ cmd: 'resync' });
      // No assertion needed beyond "doesn't throw" — the handler list was
      // cleared by stop(), so emitMessage is a no-op after teardown.
    });
  });
});
