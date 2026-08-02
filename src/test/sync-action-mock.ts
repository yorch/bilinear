import type { MockPrismaClient } from './prisma-mock';

/**
 * Test-side stand-ins for `SyncService`'s raw SyncAction writes.
 *
 * `recordSyncAction` persists through a raw `INSERT INTO "sync_actions" …
 * RETURNING` rather than `prisma.syncAction.create`, because it needs the
 * DB-assigned `xact_id` back and Prisma's query builder cannot select an
 * `Unsupported("xid8")` column. That means `prisma.syncAction.create` is no
 * longer on the path, and any test whose subject emits a SyncAction has to
 * stub `$queryRaw` instead — a detail with no business meaning that would
 * otherwise be re-derived (and re-pasted) in every such file.
 */

/** A bound `INSERT INTO "sync_actions"` parameter list, in order. */
const ORG_ID = 0;
const ACTION = 1;
const MODEL_NAME = 2;
const MODEL_ID = 3;
const DATA = 4;

interface RawQuery {
  sql?: string;
  values?: unknown[];
}

function isSyncActionInsert(query: RawQuery | undefined): boolean {
  return typeof query?.sql === 'string' && query.sql.includes('INSERT INTO "sync_actions"');
}

/**
 * Make `$queryRaw` echo a SyncAction insert back as the row
 * `recordSyncAction` expects, with an incrementing `id`/`xactId` so several
 * SyncActions in one test stay distinguishable. Non-matching raw queries
 * resolve to `[]`.
 *
 * Call from `beforeEach` after `createMockPrisma()`.
 */
export function mockSyncActionInserts(prisma: MockPrismaClient): void {
  let counter = 0;
  prisma.$queryRaw.mockImplementation((query: RawQuery) => {
    if (!isSyncActionInsert(query)) {
      return Promise.resolve([]) as never;
    }
    const values = query?.values ?? [];
    const n = ++counter;
    const rawData = values[DATA];
    return Promise.resolve([
      {
        action: values[ACTION],
        createdAt: new Date(),
        data: typeof rawData === 'string' ? JSON.parse(rawData) : null,
        id: BigInt(n),
        modelId: values[MODEL_ID],
        modelName: values[MODEL_NAME],
        organizationId: values[ORG_ID],
        xactId: String(1000 + n),
      },
    ]) as never;
  });
}

/**
 * Every SyncAction recorded through the mocked `$queryRaw`, decoded from the
 * bound parameters — so assertions read like the old
 * `prisma.syncAction.create` calls did and don't depend on the raw SQL text.
 */
export function readSyncActionInserts(prisma: MockPrismaClient) {
  return prisma.$queryRaw.mock.calls
    .map(([query]) => query as RawQuery)
    .filter(isSyncActionInsert)
    .map(query => {
      const values = query?.values ?? [];
      const rawData = values[DATA];
      return {
        action: values[ACTION],
        data: typeof rawData === 'string' ? JSON.parse(rawData) : null,
        modelId: values[MODEL_ID],
        modelName: values[MODEL_NAME],
        organizationId: values[ORG_ID],
      };
    });
}
