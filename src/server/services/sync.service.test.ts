import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMIT_WATERMARK_LAG_MS } from '../../lib/sync-config';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { parseCursor, SyncService } from './sync.service';

// A fixed DB-clock "now", deliberately far from the real system clock, so
// tests can prove the watermark is derived from the DATABASE's clock (via
// `$queryRaw`) rather than the app server's `Date.now()` — the exact
// cross-clock-skew hazard this fix closes. Every describe block below mocks
// `$queryRaw` to return this so existing delta/bootstrap assertions don't
// have to change their expectations about what "now" means, only where it
// comes from.
const DB_NOW = new Date('2020-01-01T00:00:00.000Z');

function mockDbNow(prisma: MockPrismaClient, now: Date = DB_NOW) {
  prisma.$queryRaw.mockResolvedValue([{ now }]);
}

/**
 * `getBootstrapData` fans out into ~20 Prisma queries via `Promise.all`.
 * Stub every collection query to an empty result and `findUnique`/
 * `findFirst` to `null` so tests can focus on the watermark plumbing
 * without asserting on unrelated bootstrap payload shape.
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
  prisma.syncAction.findFirst.mockResolvedValue(null);
}

// Minimal stand-in for the ioredis Redis instance — only `publish` is
// touched on the path under test (createSyncAction fires it, but the
// delta-pagination tests don't reach that code).
const mockRedis = {
  publish: vi.fn().mockResolvedValue(1),
} as unknown as ConstructorParameters<typeof SyncService>[1];

function makeAction(id: bigint, committedAt = new Date('2026-04-22T00:00:00Z')) {
  return {
    action: 'I' as const,
    committedAt,
    createdAt: committedAt,
    data: {},
    id,
    modelId: '00000000-0000-0000-0000-0000000aaaaa',
    modelName: 'Issue',
    organizationId: TEST_ORG.id,
  };
}

type DeltaCall = {
  orderBy: Array<Record<string, string>>;
  where: {
    organizationId: string;
    AND: Array<{
      committedAt?: { lte?: Date };
      OR?: Array<Record<string, unknown>>;
    }>;
  };
};

describe('SyncService.getDeltaSyncActions — pagination', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
    mockDbNow(prisma);
  });

  it('returns the page and reports hasMore=false when fewer than the cap exist', async () => {
    const rows = [makeAction(BigInt(1)), makeAction(BigInt(2)), makeAction(BigInt(3))];
    prisma.syncAction.findMany.mockResolvedValue(rows);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 5);

    expect(result.actions).toHaveLength(3);
    expect(result.hasMore).toBe(false);
    // Asks for limit + 1 to detect overflow without a separate count query.
    expect(prisma.syncAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6 }));
  });

  it('truncates to the cap and reports hasMore=true when overflow is detected', async () => {
    const rows = [
      makeAction(BigInt(1)),
      makeAction(BigInt(2)),
      makeAction(BigInt(3)),
      makeAction(BigInt(4)),
      makeAction(BigInt(5)),
      makeAction(BigInt(6)),
    ];
    prisma.syncAction.findMany.mockResolvedValue(rows);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 5);

    expect(result.actions).toHaveLength(5);
    expect(result.hasMore).toBe(true);
    expect(result.actions.at(-1)?.id).toBe(BigInt(5));
  });

  it('expresses the lower bound as a true (committedAt, id) tuple', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    const from = parseCursor('1700000000000000-100');
    await svc.getDeltaSyncActions(TEST_ORG.id, from, undefined, 50);

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as DeltaCall;
    // AND[0] is the watermark cap (applies to both branches).
    expect(call.where.AND[0].committedAt?.lte).toBeInstanceOf(Date);
    // AND[1] is the lower-bound OR — two branches: strictly-later or same-time + id-greater.
    const lowerOr = call.where.AND[1].OR as Array<{
      committedAt?: { gt?: Date } | Date;
      id?: { gt?: bigint };
    }>;
    expect(lowerOr).toHaveLength(2);
    expect((lowerOr[0].committedAt as { gt: Date }).gt).toBeInstanceOf(Date);
    expect(lowerOr[1].id?.gt).toBe(BigInt(100));
  });

  it('omits any upper-bound clause when toCursor is not provided', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as DeltaCall;
    // Only the watermark cap + lower-bound OR — no third upper-bound clause.
    expect(call.where.AND).toHaveLength(2);
  });

  it('encodes toCursor as a true tuple upper bound (catches same-committedAt rows past toId)', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    const from = parseCursor('1700000000000000-0');
    const to = parseCursor('1800000000000000-50');
    await svc.getDeltaSyncActions(TEST_ORG.id, from, to, 50);

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as DeltaCall;
    // AND has [watermark, lowerBound, upperBound].
    expect(call.where.AND).toHaveLength(3);
    const upperOr = call.where.AND[2].OR as Array<{
      committedAt?: { lt?: Date } | Date;
      id?: { lte?: bigint };
    }>;
    expect(upperOr).toHaveLength(2);
    // Strictly-earlier committedAt OR equal-committedAt with id <= toId — the
    // id tie-break is what the previous single `lte: committedAt` version
    // missed, letting rows at exactly `toCommittedAt` with bigger ids leak
    // past the intended upper bound.
    expect((upperOr[0].committedAt as { lt: Date }).lt).toBeInstanceOf(Date);
    expect(upperOr[1].id?.lte).toBe(BigInt(50));
  });

  it('orders by (committedAt, id) ASC and clamps top-level by the safety watermark', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as DeltaCall;
    expect(call.orderBy).toEqual([{ committedAt: 'asc' }, { id: 'asc' }]);
    // The watermark cap is top-level (AND[0]) so it applies to BOTH lower-
    // bound OR branches — without that, a same-committedAt + bigger-id row
    // inside the lag window could slip through the equal-time branch.
    const watermark = call.where.AND[0].committedAt?.lte;
    expect(watermark).toBeInstanceOf(Date);
    expect((watermark as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('parseCursor accepts legacy `<id>` strings as (epoch, id) tuples', () => {
    const c = parseCursor('42');
    expect(c.committedAtMicros).toBe(BigInt(0));
    expect(c.id).toBe(BigInt(42));
  });

  it('parseCursor decodes `<micros>-<id>` tuples', () => {
    const c = parseCursor('1700000000000000-99');
    expect(c.committedAtMicros).toBe(BigInt('1700000000000000'));
    expect(c.id).toBe(BigInt(99));
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
    mockDbNow(prisma);
  });

  function makeRelationAction(id: bigint, data: Record<string, unknown>) {
    return {
      action: 'I' as const,
      committedAt: new Date('2026-04-22T00:00:00Z'),
      createdAt: new Date('2026-04-22T00:00:00Z'),
      data,
      id,
      modelId: data.id as string,
      modelName: 'IssueRelation',
      organizationId: TEST_ORG.id,
    };
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
    prisma.syncAction.findMany.mockResolvedValue([makeRelationAction(BigInt(1), relationData)]);
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
    prisma.syncAction.findMany.mockResolvedValue([makeRelationAction(BigInt(2), relationData)]);
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
    prisma.syncAction.findMany.mockResolvedValue([makeRelationAction(BigInt(3), relationData)]);
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
    prisma.syncAction.findMany.mockResolvedValue([makeRelationAction(BigInt(4), relationData)]);

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'), undefined, 50, {
      guestTeamIds: [],
      userId: 'someone',
    });

    expect(result.actions).toHaveLength(1);
    // No guest scoping means no need to even look up the issues.
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
});

describe('SyncService — watermark uses the DB clock, not the app clock', () => {
  let prisma: MockPrismaClient;
  let svc: SyncService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new SyncService(prisma as never, mockRedis);
    mockDbNow(prisma);
  });

  it('derives the delta-sync watermark from `SELECT now()`, not Date.now()', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as DeltaCall;
    const watermark = call.where.AND[0].committedAt?.lte as Date;
    expect(watermark.getTime()).toBe(DB_NOW.getTime() - COMMIT_WATERMARK_LAG_MS);
    // DB_NOW is fixed in 2020 — nowhere near the real system clock. If the
    // watermark had instead been derived from the app's Date.now(), it
    // would land near the real current time, not decades in the past. This
    // is exactly the cross-clock-skew scenario the fix closes: an app
    // clock that has drifted ahead of the DB clock must not shrink the
    // safety window.
    expect(watermark.getTime()).toBeLessThan(Date.now() - 1000 * 60 * 60 * 24 * 365);
  });

  it('fetches the DB clock exactly once per delta call, even with a toCursor upper bound', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(
      TEST_ORG.id,
      parseCursor('0'),
      parseCursor('1900000000000000-1'),
      50,
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('derives the bootstrap "watermarked latest row" query from the DB clock', async () => {
    mockEmptyBootstrap(prisma);

    await svc.getBootstrapData(TEST_ORG.id, 'user-1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const call = prisma.syncAction.findFirst.mock.calls[0]?.[0] as {
      where: { committedAt?: { lte?: Date } };
    };
    expect(call.where.committedAt?.lte?.getTime()).toBe(DB_NOW.getTime() - COMMIT_WATERMARK_LAG_MS);
  });

  it('derives the getLastSyncId watermark from the DB clock', async () => {
    prisma.syncAction.findFirst.mockResolvedValue(null);

    await svc.getLastSyncId(TEST_ORG.id);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const call = prisma.syncAction.findFirst.mock.calls[0]?.[0] as {
      where: { committedAt?: { lte?: Date } };
    };
    expect(call.where.committedAt?.lte?.getTime()).toBe(DB_NOW.getTime() - COMMIT_WATERMARK_LAG_MS);
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

  it('recordSyncAction writes via the supplied client and does NOT publish', async () => {
    const action = makeAction(BigInt(7));
    // A distinct "tx" client to prove the row is written on IT, not the singleton.
    const tx = { syncAction: { create: vi.fn().mockResolvedValue(action) } };

    const result = await svc.recordSyncAction(
      tx as never,
      TEST_ORG.id,
      'I',
      'Issue',
      action.modelId,
      {
        title: 'x',
      },
    );

    expect(tx.syncAction.create).toHaveBeenCalledTimes(1);
    // The singleton client must not be touched — the marker is transaction-scoped.
    expect(prisma.syncAction.create).not.toHaveBeenCalled();
    // Publishing inside the tx would broadcast a row a rollback could erase.
    expect(redis.publish).not.toHaveBeenCalled();
    expect(result).toBe(action);
  });

  it('publish broadcasts the action on the org channel as serialized JSON', () => {
    const action = makeAction(BigInt(9));
    svc.publish(action);

    expect(redis.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = redis.publish.mock.calls[0] as [string, string];
    expect(channel).toBe(`sync:${TEST_ORG.id}`);
    // id is serialized to string so BigInt survives JSON transport.
    expect(JSON.parse(payload)).toMatchObject({ id: '9', modelName: 'Issue' });
  });

  it('createSyncAction records on the singleton AND publishes (back-compat path)', async () => {
    const action = makeAction(BigInt(11));
    prisma.syncAction.create.mockResolvedValue(action);

    const result = await svc.createSyncAction(TEST_ORG.id, 'U', 'Issue', action.modelId, {});

    expect(prisma.syncAction.create).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(result).toBe(action);
  });
});
