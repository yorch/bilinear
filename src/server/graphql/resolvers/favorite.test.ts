import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { favoriteResolvers } from './favorite';

describe('favoriteResolvers.favoriteDelete', () => {
  let ctx: MockGraphQLContext;
  beforeEach(() => {
    ctx = createMockContext();
  });

  it("emits a D whose payload carries the owner's userId (so other members never receive it)", async () => {
    const removed = { id: 'f1', userId: ctx.userId };
    // The shared mock context has no favorite service; stub just the one call.
    (ctx.services as unknown as { favorite: unknown }).favorite = {
      delete: vi.fn().mockResolvedValue(removed),
    };
    const spy = vi.spyOn(ctx.services.sync, 'createSyncAction');

    const out = await favoriteResolvers.Mutation.favoriteDelete({}, { id: 'f1' }, ctx as never);

    expect(spy).toHaveBeenCalledWith(ctx.orgId, 'D', 'Favorite', 'f1', removed);
    expect(out).toEqual({ lastSyncId: '1', success: true });
  });
});
