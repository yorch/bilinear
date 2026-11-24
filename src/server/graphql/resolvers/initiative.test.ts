import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ORG } from '../../../test/fixtures';
import { initiativeResolvers } from './initiative';

const INITIATIVE = {
  archivedAt: null,
  id: '00000000-0000-0000-0000-000000000a00',
  name: 'Platform',
  organizationId: TEST_ORG.id,
};

describe('Mutation.initiativeUnarchive', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  it('throws UNAUTHENTICATED when not logged in', async () => {
    await testAuthGuard(
      initiativeResolvers.Mutation.initiativeUnarchive,
      { id: INITIATIVE.id },
      createMockContext({ orgId: null, userId: null }),
      'UNAUTHENTICATED',
    );
  });

  it('throws NOT_FOUND when no initiative in the org matches', async () => {
    ctx.prisma.initiative.updateMany.mockResolvedValue({ count: 0 });
    await testAuthGuard(
      initiativeResolvers.Mutation.initiativeUnarchive,
      { id: 'missing' },
      ctx,
      'NOT_FOUND',
    );
  });

  it('clears archivedAt, scoped to the org, and creates a SyncAction', async () => {
    ctx.prisma.initiative.updateMany.mockResolvedValue({ count: 1 });
    ctx.prisma.initiative.findUnique.mockResolvedValue(INITIATIVE);
    const createSyncAction = vi.spyOn(ctx.services.sync, 'createSyncAction');

    const res = await initiativeResolvers.Mutation.initiativeUnarchive(
      null,
      { id: INITIATIVE.id },
      ctx as never,
    );

    expect(ctx.prisma.initiative.updateMany).toHaveBeenCalledWith({
      data: { archivedAt: null },
      where: { id: INITIATIVE.id, organizationId: TEST_ORG.id },
    });
    expect(createSyncAction).toHaveBeenCalledWith(
      TEST_ORG.id,
      'U',
      'Initiative',
      INITIATIVE.id,
      INITIATIVE,
    );
    expect(res.lastSyncId).toBe('1');
  });
});
