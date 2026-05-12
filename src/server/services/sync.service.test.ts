import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { parseCursor, SyncService } from './sync.service';

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
