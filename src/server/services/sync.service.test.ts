import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { SyncService } from './sync.service';

// Minimal stand-in for the ioredis Redis instance — only `publish` is
// touched on the path under test (createSyncAction fires it, but the
// delta-pagination tests don't reach that code).
const mockRedis = {
  publish: vi.fn().mockResolvedValue(1),
} as unknown as ConstructorParameters<typeof SyncService>[1];

function makeAction(id: bigint) {
  return {
    action: 'I' as const,
    createdAt: new Date('2026-04-22T00:00:00Z'),
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

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, BigInt(0), undefined, 5);

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

    const result = await svc.getDeltaSyncActions(TEST_ORG.id, BigInt(0), undefined, 5);

    expect(result.actions).toHaveLength(5);
    expect(result.hasMore).toBe(true);
    expect(result.actions.at(-1)?.id).toBe(BigInt(5));
  });

  it('passes lastSyncId / toSyncId through as cursor bounds', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, BigInt(100), BigInt(200), 50);

    expect(prisma.syncAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { gt: BigInt(100), lte: BigInt(200) },
          organizationId: TEST_ORG.id,
        }),
      }),
    );
  });

  it('omits the upper bound when toSyncId is not provided', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, BigInt(0));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as {
      where: { id: { gt: bigint; lte?: bigint } };
    };
    expect(call.where.id.gt).toBe(BigInt(0));
    expect(call.where.id.lte).toBeUndefined();
  });

  it('filters rows newer than the commit watermark', async () => {
    prisma.syncAction.findMany.mockResolvedValue([]);

    await svc.getDeltaSyncActions(TEST_ORG.id, BigInt(0));

    const call = prisma.syncAction.findMany.mock.calls[0]?.[0] as {
      where: { committedAt: { lte: Date } };
      orderBy: Array<Record<string, string>>;
    };
    // Bound is current-time-ish (allow for test execution slack).
    expect(call.where.committedAt.lte).toBeInstanceOf(Date);
    expect(call.where.committedAt.lte.getTime()).toBeLessThanOrEqual(Date.now());
    // Cursor orders by commit time first so an out-of-order id can't
    // leapfrog ahead of an earlier-committed but later-id row.
    expect(call.orderBy).toEqual([{ committedAt: 'asc' }, { id: 'asc' }]);
  });
});
