import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { encodeCursor, parseCursor, SyncService } from './sync.service';

// Minimal stand-in for the ioredis Redis instance — only `publish` is
// touched on the path under test (createSyncAction fires it, but the
// delta-pagination tests don't reach that code).
const mockRedis = {
  publish: vi.fn().mockResolvedValue(1),
} as unknown as ConstructorParameters<typeof SyncService>[1];

/**
 * A raw `sync_actions` row as the delta/insert queries return it: `xact_id`
 * is cast to text (`xid8::text`), `id` is a BIGINT (bigint), and there is no
 * `committed_at` column — the commit-order fence is the `xact_id` xid8. The
 * service's `mapRow` turns `xactId` back into a BigInt.
 */
function makeRawRow(id: bigint, xactId: string, extra: Record<string, unknown> = {}) {
  return {
    action: 'I' as const,
    createdAt: new Date('2026-04-22T00:00:00Z'),
    data: {},
    id,
    modelId: '00000000-0000-0000-0000-0000000aaaaa',
    modelName: 'Issue',
    organizationId: TEST_ORG.id,
    xactId,
    ...extra,
  };
}

/** The single `Prisma.Sql` argument passed to a mocked `$queryRaw` call. */
function rawQuery(prisma: MockPrismaClient, callIndex = 0): { sql: string; values: unknown[] } {
  return prisma.$queryRaw.mock.calls[callIndex]?.[0] as { sql: string; values: unknown[] };
}

/**
 * `getBootstrapData` fans out into ~20 Prisma queries via `Promise.all`.
 * Stub every collection query to an empty result and `findUnique` to `null`
 * so tests can focus on the cursor plumbing without asserting on unrelated
 * bootstrap payload shape. The fenced "latest settled row" query runs through
 * `$queryRaw`, mocked separately per test.
 */
function mockEmptyBootstrap(prisma: MockPrismaClient) {
  prisma.organization.findUnique.mockResolvedValue(null);
  const emptyModels = [
    'team',
    'user',
    'issue',
    'workflowState',
    'issueLabel',
    'issueLabelAssignment',
    'cycle',
    'document',
    'project',
    'projectMilestone',
    'projectUpdate',
    'customView',
    'issueRelation',
    'issueTemplate',
    'customFieldDefinition',
    'customFieldValue',
    'initiative',
    'initiativeProject',
  ] as const;
  for (const model of emptyModels) {
    prisma[model].findMany.mockResolvedValue([]);
  }
}

describe('SyncService.getDeltaSyncActions — pagination', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
  });

  it('returns the page and reports hasMore=false when fewer than the cap exist', async () => {
    const rows = [
      makeRawRow(BigInt(1), '1001'),
      makeRawRow(BigInt(2), '1002'),
      makeRawRow(BigInt(3), '1003'),
    ];
    prisma.$queryRaw.mockResolvedValue(rows);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 5);

    expect(result.actions).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    // xact_id::text is parsed back into a BigInt by mapRow.
    expect(result.actions[0].xactId).toBe(BigInt(1001));
    // Asks for limit + 1 to detect overflow without a separate count query.
    expect(rawQuery(prisma).values).toContain(6);
  });

  it('truncates to the cap and reports hasMore=true when overflow is detected', async () => {
    const rows = [
      makeRawRow(BigInt(1), '1001'),
      makeRawRow(BigInt(2), '1002'),
      makeRawRow(BigInt(3), '1003'),
      makeRawRow(BigInt(4), '1004'),
      makeRawRow(BigInt(5), '1005'),
      makeRawRow(BigInt(6), '1006'),
    ];
    prisma.$queryRaw.mockResolvedValue(rows);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 5);

    expect(result.actions).toHaveLength(5);
    expect(result.hasMore).toBe(true);
    expect(result.actions.at(-1)?.id).toBe(BigInt(5));
  });

  it('expresses the lower bound as a true (xactId, id) tuple', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const from = parseCursor('1700-100');
    await svc.getDeltaSyncActions(TEST_ORG.id, from, undefined, 50);

    const { sql, values } = rawQuery(prisma);
    // The lower bound is `xact_id > $ OR (xact_id = $ AND id > $)` — the
    // xactId appears twice (both branches) and the id tie-break once.
    expect(sql).toContain('"xact_id" > ');
    expect(sql).toContain('"id" > ');
    expect(values.filter(v => v === '1700')).toHaveLength(2);
    expect(values).toContain(BigInt(100));
  });

  it('omits any upper-bound clause when toCursor is not provided', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const { sql } = rawQuery(prisma);
    // Only the fence `<` and the lower-bound `>` — no upper-bound `<` on the
    // cursor tuple (which would compare against a `::xid8` param twice more).
    expect(sql).toContain('pg_snapshot_xmin(pg_current_snapshot())');
    // Exactly one `::xid8` pair from the lower bound → two `::xid8` casts.
    expect(sql.match(/::xid8/g) ?? []).toHaveLength(2);
  });

  it('encodes toCursor as a true tuple upper bound (catches same-xactId rows past toId)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    const from = parseCursor('1700-0');
    const to = parseCursor('1800-50');
    await svc.getDeltaSyncActions(TEST_ORG.id, from, to, 50);

    const { sql, values } = rawQuery(prisma);
    // Lower bound (2 casts) + upper bound (2 casts) = 4 `::xid8` casts.
    expect(sql.match(/::xid8/g) ?? []).toHaveLength(4);
    expect(sql).toContain('"xact_id" < ');
    // The id tie-break on the upper bound is what a bare `<= toXact` would
    // miss, letting rows at exactly `toXact` with bigger ids leak past.
    expect(values.filter(v => v === '1800')).toHaveLength(2);
    expect(values).toContain(BigInt(50));
  });

  it('orders by (xactId, id) ASC and fences on the commit-order snapshot xmin', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const { sql } = rawQuery(prisma);
    expect(sql).toContain('ORDER BY "xact_id" ASC, "id" ASC');
    // The fence — a row is served only once its transaction has settled and
    // no smaller-xid transaction is still in flight. This is the provably
    // never-skip replacement for the old wall-clock committed_at watermark.
    expect(sql).toContain('"xact_id" < pg_snapshot_xmin(pg_current_snapshot())');
    // Never issues a `SELECT now()` — the fence needs no app-vs-DB clock.
    expect(sql).not.toMatch(/now\(\)/i);
  });

  it('parseCursor accepts legacy `<id>` strings as (0, id) tuples', () => {
    const c = parseCursor('42');
    expect(c.xactId).toBe(BigInt(0));
    expect(c.id).toBe(BigInt(42));
  });

  it('parseCursor decodes `<xactId>-<id>` tuples', () => {
    const c = parseCursor('1700-99');
    expect(c.xactId).toBe(BigInt('1700'));
    expect(c.id).toBe(BigInt(99));
  });

  it('parseCursor resets a stale `<committedAtMicros>-<id>` cursor to zero (self-heal)', () => {
    // A cursor from before the xact_id migration: the first component is an
    // epoch-microseconds value (~1.7e15) far above any real xid8. Parsing it as
    // an xactId would make `xact_id > 1.7e15` match nothing and wedge delta
    // forever — so it must reset to the zero cursor for a full re-read.
    const c = parseCursor('1750000000000000-12345');
    expect(c.xactId).toBe(BigInt(0));
    expect(c.id).toBe(BigInt(0));
  });

  it('encodeCursor round-trips a (xactId, id) tuple', () => {
    expect(encodeCursor(BigInt(1700), BigInt(99))).toBe('1700-99');
  });
});

describe('SyncService.getDeltaSyncActions — guest visibility (IssueRelation both endpoints)', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;

  const GUEST_TEAM = '00000000-0000-0000-0000-0000000team1';
  const OTHER_TEAM = '00000000-0000-0000-0000-0000000team2';
  const GUEST_USER = '00000000-0000-0000-0000-00000guest1';

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
  });

  function makeRelationRow(id: bigint, data: Record<string, unknown>) {
    return makeRawRow(id, `10${id}`, {
      data,
      modelId: data.id as string,
      modelName: 'IssueRelation',
    });
  }

  it('drops an IssueRelation row when only the `issue` side is guest-visible but `relatedIssue` is not', async () => {
    // Previously only `issueId` was checked, so a guest could see this row
    // (and thus the relatedIssue's UUID + relation type) purely because the
    // `issue` side was visible, even though the relatedIssue sits on a
    // guest-restricted team the caller has no other access to.
    const relationData = {
      id: 'rel-1',
      issueId: 'issue-visible',
      relatedIssueId: 'issue-hidden',
      type: 'blocks',
    };
    prisma.$queryRaw.mockResolvedValue([makeRelationRow(BigInt(1), relationData)]);
    prisma.issue.findMany.mockResolvedValue([
      { assigneeId: null, creatorId: null, id: 'issue-visible', teamId: OTHER_TEAM },
      { assigneeId: null, creatorId: 'someone-else', id: 'issue-hidden', teamId: GUEST_TEAM },
    ]);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 50, {
      guestTeamIds: [GUEST_TEAM],
      userId: GUEST_USER,
    });

    expect(result.actions).toHaveLength(0);
  });

  it('drops an IssueRelation row when only the `relatedIssue` side is guest-visible but `issue` is not', async () => {
    const relationData = {
      id: 'rel-2',
      issueId: 'issue-hidden',
      relatedIssueId: 'issue-visible',
      type: 'blocks',
    };
    prisma.$queryRaw.mockResolvedValue([makeRelationRow(BigInt(2), relationData)]);
    prisma.issue.findMany.mockResolvedValue([
      { assigneeId: null, creatorId: 'someone-else', id: 'issue-hidden', teamId: GUEST_TEAM },
      { assigneeId: null, creatorId: null, id: 'issue-visible', teamId: OTHER_TEAM },
    ]);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 50, {
      guestTeamIds: [GUEST_TEAM],
      userId: GUEST_USER,
    });

    expect(result.actions).toHaveLength(0);
  });

  it('keeps an IssueRelation row when both endpoints are guest-visible', async () => {
    const relationData = {
      id: 'rel-3',
      issueId: 'issue-a',
      relatedIssueId: 'issue-b',
      type: 'related',
    };
    prisma.$queryRaw.mockResolvedValue([makeRelationRow(BigInt(3), relationData)]);
    prisma.issue.findMany.mockResolvedValue([
      { assigneeId: null, creatorId: null, id: 'issue-a', teamId: OTHER_TEAM },
      { assigneeId: GUEST_USER, creatorId: null, id: 'issue-b', teamId: GUEST_TEAM },
    ]);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 50, {
      guestTeamIds: [GUEST_TEAM],
      userId: GUEST_USER,
    });

    expect(result.actions).toHaveLength(1);
  });

  it('does not filter IssueRelation rows for a non-guest caller (empty guestTeamIds)', async () => {
    const relationData = {
      id: 'rel-4',
      issueId: 'issue-x',
      relatedIssueId: 'issue-y',
      type: 'blocks',
    };
    prisma.$queryRaw.mockResolvedValue([makeRelationRow(BigInt(4), relationData)]);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 50, {
      guestTeamIds: [],
      userId: 'someone',
    });

    expect(result.actions).toHaveLength(1);
    // No guest scoping means no need to even look up the issues.
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
});

describe('SyncService — commit-order fence (xact_id / snapshot xmin)', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
  });

  it('fences the delta read on the snapshot xmin and issues exactly one query', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), parseCursor('1900-1'), 50);

    // One raw query for the whole delta — no separate `SELECT now()` watermark
    // round-trip like the former wall-clock design needed.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(prisma).sql).toContain('pg_snapshot_xmin(pg_current_snapshot())');
  });

  it('derives the bootstrap cursor from the fenced latest settled row', async () => {
    mockEmptyBootstrap(prisma);
    prisma.$queryRaw.mockResolvedValue([{ id: BigInt(7), xactId: '4242' }]);

    const data = await svc.getBootstrapData(TEST_ORG.id, 'user-1');

    // Exactly one `$queryRaw` — the fenced latest-row query inside Promise.all.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(prisma).sql).toContain('"xact_id" < pg_snapshot_xmin(pg_current_snapshot())');
    expect(data.lastSyncId).toBe('4242-7');
  });

  it('returns 0-0 when the org has no settled SyncActions yet', async () => {
    mockEmptyBootstrap(prisma);
    prisma.$queryRaw.mockResolvedValue([]);

    const data = await svc.getBootstrapData(TEST_ORG.id, 'user-1');
    expect(data.lastSyncId).toBe('0-0');
  });

  it('getLastSyncId encodes the fenced latest settled tuple', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: BigInt(99), xactId: '5000' }]);

    const cursor = await svc.getLastSyncId(TEST_ORG.id);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(prisma).sql).toContain('ORDER BY "xact_id" DESC, "id" DESC');
    expect(cursor).toBe('5000-99');
  });
});

describe('SyncService — atomic write helpers', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;
  const redis = { publish: vi.fn().mockResolvedValue(1) };

  beforeEach(() => {
    redis.publish.mockClear();
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, redis as never);
  });

  it('recordSyncAction writes via the supplied client (RETURNING xact_id) and does NOT publish', async () => {
    const row = makeRawRow(BigInt(7), '700');
    // A distinct "tx" client to prove the row is written on IT, not the singleton.
    const tx = { $queryRaw: vi.fn().mockResolvedValue([row]) };

    const result = await svc.recordSyncAction(tx as never, TEST_ORG.id, 'I', 'Issue', row.modelId, {
      title: 'x',
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // The singleton client must not be touched — the marker is transaction-scoped.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    // Publishing inside the tx would broadcast a row a rollback could erase.
    expect(redis.publish).not.toHaveBeenCalled();
    // xact_id::text is parsed back to a BigInt.
    expect(result.xactId).toBe(BigInt(700));
    expect(result.id).toBe(BigInt(7));
  });

  it('publish broadcasts the action on the org channel as serialized JSON (id + xactId as strings)', () => {
    const row = makeRawRow(BigInt(9), '900');
    // recordSyncAction returns a mapped row (xactId is a BigInt); mirror that.
    svc.publish({ ...row, xactId: BigInt(900) });

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(`sync:${TEST_ORG.id}`);
    // id and xactId are serialized to strings so the 64-bit values survive JSON.
    expect(JSON.parse(payload)).toMatchObject({ id: '9', modelName: 'Issue', xactId: '900' });
  });

  it('createSyncAction records on the singleton AND publishes (back-compat path)', async () => {
    const row = makeRawRow(BigInt(11), '1100');
    prisma.$queryRaw.mockResolvedValue([row]);

    const result = await svc.createSyncAction(TEST_ORG.id, 'U', 'Issue', row.modelId, {});

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(result.xactId).toBe(BigInt(1100));
  });
});
