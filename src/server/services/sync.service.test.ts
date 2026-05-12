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
    // Server returned 6 rows (limit + 1) → there is at least one more page.
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

  it('passes a tuple cursor through as a tuple-greater-than filter', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    // 1700000000000000 microseconds = 1700000000000 ms; id=100.
    const from = parseCursor('1700000000000000-100');
    await svc.getDeltaSyncActions(TEST_ORG.id, from, undefined, 50);

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    // The query must encode (committed_at, id) > (fromCommittedAt, fromId)
    // as two OR branches — committed_at strictly greater, OR equal AND id
    // greater. Anything else (e.g. `id > fromId` alone) would skip a row
    // whose tx commits late at an earlier id.
    expect(call.where.OR).toHaveLength(2);
    expect((call.where.OR[0].committedAt as { gt: Date }).gt).toBeInstanceOf(Date);
    expect((call.where.OR[1].id as { gt: bigint }).gt).toBe(BigInt(100));
  });

  it('omits the upper bound when toCursor is not provided', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<{ committedAt: { lte?: Date } | Date; id?: { lte?: bigint } }> };
    };
    // No `lte` on the id sub-branch (only `gt` from the cursor).
    const idBranch = call.where.OR[1];
    expect(idBranch.id?.lte).toBeUndefined();
  });

  it('orders by (committedAt, id) ASC and clamps by the safety watermark', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, parseCursor('0'));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as {
      orderBy: Array<Record<string, string>>;
      where: { OR: Array<{ committedAt?: { lte?: Date } }> };
    };
    expect(call.orderBy).toEqual([{ committedAt: 'asc' }, { id: 'asc' }]);
    // Watermark applied to the strictly-greater branch so a fresh row whose
    // tx is still in-flight cannot leapfrog the cursor.
    const watermark = call.where.OR[0].committedAt?.lte;
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
