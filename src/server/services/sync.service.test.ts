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
const UNRESTRICTED = { guestTeamIds: [], hiddenTeamIds: [], userId: 'user-1' };

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

  it('deletes and marks in one statement, so a concurrent delta cannot see a half-applied prune', async () => {
    // An earlier version marked and deleted in two round-trips, which left a
    // window where a delta read the old mark and was served a silently
    // incomplete page — advancing its cursor past rows that no longer exist.
    // A data-modifying CTE makes both halves atomic.
    prisma.$queryRaw.mockResolvedValue([{ deleted: 4, orgs: 1 }]);

    const pruned = await svc.pruneSyncActions();

    expect(pruned).toBe(4);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [[query]] = prisma.$queryRaw.mock.calls as Array<[{ sql: string }]>;
    expect(query.sql).toContain('DELETE FROM "sync_actions"');
    expect(query.sql).toContain('UPDATE "organizations"');
    // The mark must never move backwards — under-reporting staleness corrupts
    // a cache, over-reporting costs one bootstrap.
    expect(query.sql).toContain('GREATEST');
    // Pruned by wall-clock age, but marked in xact_id space, because that is
    // what the delta cursor is keyed on.
    expect(query.sql).toContain('"created_at" <');
    expect(query.sql).toContain('MAX("xact_num")');
  });

  it('reports nothing pruned when no rows fall inside the retention cutoff', async () => {
    prisma.$queryRaw.mockResolvedValue([{ deleted: 0, orgs: 0 }]);

    expect(await svc.pruneSyncActions()).toBe(0);
  });

  it('reports staleCursor when the cursor sits below what the retention sweep deleted', async () => {
    // The mark is the highest xact_id the sweep deleted; a cursor below it
    // needs rows that no longer exist, so serving a partial page would leave
    // the client's cache silently and permanently wrong.
    prisma.organization.findUnique.mockResolvedValue({
      syncActionsPrunedThroughXactId: '5000',
    });

    const cursor = parseCursor(encodeCursor(BigInt(4000), BigInt(7)));
    const result = await svc.getDeltaSyncActions(TEST_ORG.id, cursor, undefined, 5);

    expect(result.staleCursor).toBe(true);
    expect(result.actions).toEqual([]);
    expect(result.hasMore).toBe(false);
    // Never even ran the page query — there is nothing useful to return.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('does not report staleCursor for a cursor exactly at the mark', async () => {
    // Boundary: everything up to and including the mark was deleted, and the
    // cursor is exclusive — a client already past it missed nothing.
    prisma.organization.findUnique.mockResolvedValue({
      syncActionsPrunedThroughXactId: '5000',
    });
    prisma.$queryRaw.mockResolvedValue([makeRawRow(BigInt(1), '5001')]);

    const cursor = parseCursor(encodeCursor(BigInt(5000), BigInt(7)));
    const result = await svc.getDeltaSyncActions(TEST_ORG.id, cursor, undefined, 5);

    expect(result.staleCursor).toBe(false);
  });

  it('does not report staleCursor when nothing has ever been pruned', async () => {
    // `parseCursor` maps a legacy id-only cursor to 0 on purpose so delta can
    // catch it up. Testing against a computed `now - retention` horizon rather
    // than a recorded mark would have flagged every such client as stale and
    // forced a needless full bootstrap.
    prisma.organization.findUnique.mockResolvedValue({
      syncActionsPrunedThroughXactId: null,
    });
    prisma.$queryRaw.mockResolvedValue([makeRawRow(BigInt(1), '100')]);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 5);

    expect(result.staleCursor).toBe(false);
    expect(result.actions).toHaveLength(1);
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
      hiddenTeamIds: [],
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
      hiddenTeamIds: [],
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
      hiddenTeamIds: [],
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
      hiddenTeamIds: [],
      userId: 'someone',
    });

    expect(result.actions).toHaveLength(1);
    // No guest scoping means no need to even look up the issues.
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
});

describe('SyncService — private-team visibility (hiddenTeamIds)', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;

  const HIDDEN_TEAM = '00000000-0000-0000-0000-000000hidden';
  const OPEN_TEAM = '00000000-0000-0000-0000-00000000open';
  const VIEWER = '00000000-0000-0000-0000-00000viewer1';
  const scope = { guestTeamIds: [], hiddenTeamIds: [HIDDEN_TEAM], userId: VIEWER };

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
  });

  function row(id: number, modelName: string, data: Record<string, unknown> | null) {
    return makeRawRow(BigInt(id), `10${id}`, { data, modelId: String(data?.id ?? id), modelName });
  }

  it('bootstrap excludes the hidden team and everything scoped to it', async () => {
    mockEmptyBootstrap(prisma);
    prisma.$queryRaw.mockResolvedValue([{ id: BigInt(1), xactId: '10' }]);

    await svc.getBootstrapData(TEST_ORG.id, scope);

    const whereOf = (model: 'team' | 'issue' | 'cycle' | 'workflowState' | 'customView') =>
      (prisma[model].findMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;
    expect(whereOf('team')).toMatchObject({ id: { notIn: [HIDDEN_TEAM] } });
    expect(whereOf('issue')).toMatchObject({ teamId: { notIn: [HIDDEN_TEAM] } });
    expect(whereOf('cycle')).toMatchObject({ teamId: { notIn: [HIDDEN_TEAM] } });
    expect(whereOf('workflowState')).toMatchObject({ teamId: { notIn: [HIDDEN_TEAM] } });
    // Nullable teamId: workspace-scoped rows must still be admitted.
    expect(whereOf('customView')).toMatchObject({
      OR: [{ teamId: null }, { teamId: { notIn: [HIDDEN_TEAM] } }],
    });
  });

  it('bootstrap adds no team clauses for an unrestricted caller', async () => {
    mockEmptyBootstrap(prisma);
    prisma.$queryRaw.mockResolvedValue([{ id: BigInt(1), xactId: '10' }]);

    await svc.getBootstrapData(TEST_ORG.id, UNRESTRICTED);

    const teamWhere = (prisma.team.findMany.mock.calls[0] as [{ where: object }])[0].where;
    const issueWhere = (prisma.issue.findMany.mock.calls[0] as [{ where: object }])[0].where;
    expect(teamWhere).toEqual({ archivedAt: null, organizationId: TEST_ORG.id });
    expect(issueWhere).toEqual({ archivedAt: null, organizationId: TEST_ORG.id, trashed: false });
  });

  it('delta drops team-scoped rows of a hidden team and rewrites its Team row to a delete', async () => {
    prisma.$queryRaw.mockResolvedValue([
      row(1, 'Team', { id: HIDDEN_TEAM, name: 'Secret', private: true }),
      row(2, 'Team', { id: OPEN_TEAM, name: 'Open', private: false }),
      row(3, 'Issue', { id: 'i-hidden', teamId: HIDDEN_TEAM, title: 'leak' }),
      row(4, 'Issue', { id: 'i-open', teamId: OPEN_TEAM, title: 'fine' }),
      row(5, 'Cycle', { id: 'c-hidden', teamId: HIDDEN_TEAM }),
      row(6, 'Comment', { body: 'leak', id: 'cm-hidden', issueId: 'i-hidden' }),
      row(7, 'Comment', { body: 'fine', id: 'cm-open', issueId: 'i-open' }),
      row(8, 'Issue', null),
    ]);
    prisma.issue.findMany.mockResolvedValue([
      { assigneeId: null, creatorId: null, id: 'i-hidden', teamId: HIDDEN_TEAM },
      { assigneeId: null, creatorId: null, id: 'i-open', teamId: OPEN_TEAM },
    ]);

    const result = await svc.getDeltaSyncActions(
      TEST_ORG.id,
      parseCursor('0'),
      undefined,
      50,
      scope,
    );

    const summary = result.actions.map(a => `${a.modelName}:${a.action}:${a.modelId}`);
    expect(summary).toEqual([
      `Team:D:${HIDDEN_TEAM}`,
      `Team:I:${OPEN_TEAM}`,
      'Issue:I:i-open',
      'Comment:I:cm-open',
      'Issue:I:8',
    ]);
    expect(result.actions[0]?.data).toBeNull();
    // The page end, not the last visible row — a client paging from the last
    // visible action would re-fetch the rows just filtered out.
    expect(result.nextCursor).toBe('108-8');
  });

  it('returns a null nextCursor for an empty page', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const result = await svc.getDeltaSyncActions(
      TEST_ORG.id,
      parseCursor('0'),
      undefined,
      50,
      scope,
    );
    expect(result).toEqual({ actions: [], hasMore: false, nextCursor: null, staleCursor: false });
  });

  it('a guest still receives team metadata but only their own issues on the guest team', async () => {
    const guestScope = { guestTeamIds: [OPEN_TEAM], hiddenTeamIds: [], userId: VIEWER };
    prisma.$queryRaw.mockResolvedValue([
      row(1, 'Cycle', { id: 'c1', teamId: OPEN_TEAM }),
      row(2, 'Issue', { assigneeId: null, creatorId: 'other', id: 'i-other', teamId: OPEN_TEAM }),
      row(3, 'Issue', { assigneeId: VIEWER, creatorId: 'other', id: 'i-mine', teamId: OPEN_TEAM }),
    ]);

    const result = await svc.getDeltaSyncActions(
      TEST_ORG.id,
      parseCursor('0'),
      undefined,
      50,
      guestScope,
    );

    expect(result.actions.map(a => a.modelId)).toEqual(['c1', 'i-mine']);
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

    const data = await svc.getBootstrapData(TEST_ORG.id, UNRESTRICTED);

    // Exactly one `$queryRaw` — the fenced latest-row query inside Promise.all.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rawQuery(prisma).sql).toContain('"xact_id" < pg_snapshot_xmin(pg_current_snapshot())');
    expect(data.lastSyncId).toBe('4242-7');
  });

  it('anchors at the settled frontier, not 0-0, when the org has no settled SyncActions', async () => {
    // '0-0' reads as "infinitely far behind". Once an org has had anything
    // pruned, a cursor there fails the retention staleness test, so the client
    // is sent back to bootstrap — which hands it '0-0' again. Anchoring at the
    // current snapshot frontier instead breaks that loop.
    //
    // `xmin - 1` because the cursor is exclusive (`xact_id >`) and a row
    // sitting exactly at xmin belongs to a still-in-flight transaction; it
    // stays deliverable once it settles.
    mockEmptyBootstrap(prisma);
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ xmin: '7000' }]);

    const data = await svc.getBootstrapData(TEST_ORG.id, UNRESTRICTED);
    expect(data.lastSyncId).toBe('6999-0');
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

  it('strips the Yjs binary blob from Issue and Document payloads', async () => {
    // The insert goes through raw SQL (the xid8 default isn't expressible in
    // the Prisma query builder), so assert on the bound jsonb param.
    const raw = vi.fn().mockResolvedValue([makeRawRow(BigInt(13), '1300')]);
    const tx = { $queryRaw: raw } as never;
    const modelId = '00000000-0000-0000-0000-0000000aaaaa';

    await svc.recordSyncAction(tx, TEST_ORG.id, 'U', 'Issue', modelId, {
      descriptionState: Buffer.from([1, 2, 3]),
      id: modelId,
      title: 'x',
    });
    await svc.recordSyncAction(tx, TEST_ORG.id, 'U', 'Document', modelId, {
      contentState: Buffer.from([1, 2, 3]),
      id: modelId,
      title: 'y',
    });

    // A Buffer nested in a jsonb param is base64-encoded rather than rejected,
    // so without the strip these payloads would silently carry the whole
    // collaborative-editing blob to every client in the org.
    const payloads = raw.mock.calls.map(([q]) =>
      JSON.parse((q as { values: unknown[] }).values[4] as string),
    );
    expect(payloads[0]).toEqual({ id: modelId, title: 'x' });
    expect(payloads[1]).toEqual({ id: modelId, title: 'y' });
  });

  // The Organization entry in SYNC_PAYLOAD_OMITTED_FIELDS is gone along with
  // the `authSettings`/`securitySettings` columns it existed to hide. Org
  // configuration now lives in `settings`, which is never part of a synced
  // Organization row — so there is nothing to strip, and the row travels whole.
  //
  // This still guards something: re-introducing an Organization omit entry
  // (or a config column on the org row) turns it red.
  it('passes an Organization payload through unstripped', async () => {
    const raw = vi.fn().mockResolvedValue([makeRawRow(BigInt(14), '1400')]);
    const tx = { $queryRaw: raw } as never;

    await svc.recordSyncAction(tx, TEST_ORG.id, 'U', 'Organization', TEST_ORG.id, {
      aiEnabled: true,
      id: TEST_ORG.id,
      name: 'Test Org',
    });

    const [[q]] = raw.mock.calls;
    expect(JSON.parse((q as { values: unknown[] }).values[4] as string)).toEqual({
      aiEnabled: true,
      id: TEST_ORG.id,
      name: 'Test Org',
    });
  });

  it('leaves payloads for other models untouched', async () => {
    const raw = vi.fn().mockResolvedValue([makeRawRow(BigInt(15), '1500')]);
    const tx = { $queryRaw: raw } as never;
    const modelId = '00000000-0000-0000-0000-0000000aaaaa';
    // Same field name, different model — the strip is keyed on modelName.
    const payload = { descriptionState: 'not-a-blob', id: modelId };

    await svc.recordSyncAction(tx, TEST_ORG.id, 'U', 'Project', modelId, payload);

    const [[q]] = raw.mock.calls;
    expect(JSON.parse((q as { values: unknown[] }).values[4] as string)).toEqual(payload);
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
