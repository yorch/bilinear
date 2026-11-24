import type { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '@/test/context-mock';
import { TEST_ORG, TEST_USER } from '@/test/fixtures';
import { userResolvers } from './user';

const OTHER_ORG = { ...TEST_ORG, id: '00000000-0000-0000-0000-0000000000f2', urlKey: 'other' };

describe('userUpdateProfile', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
    ctx.prisma.user.update.mockResolvedValue({ ...TEST_USER, name: 'Ada Lovelace' });
    ctx.prisma.user.findUnique.mockResolvedValue({ ...TEST_USER, name: 'Ada Lovelace' });
    ctx.prisma.organizationMember.findMany.mockResolvedValue([
      { organization: TEST_ORG, role: 'member' },
      { organization: OTHER_ORG, role: 'member' },
    ]);
  });

  it('announces a User SyncAction in every workspace the viewer belongs to', async () => {
    const spy = vi.spyOn(ctx.services.sync, 'createSyncAction');

    const result = await userResolvers.Mutation.userUpdateProfile(
      null,
      { input: { name: 'Ada Lovelace' } },
      ctx as never,
    );

    expect(spy.mock.calls.map(c => [c[0], c[1], c[2]])).toEqual([
      [TEST_ORG.id, 'U', 'User'],
      [OTHER_ORG.id, 'U', 'User'],
    ]);
    expect(result.lastSyncId).toBe('1');
    expect(result.success).toBe(true);
  });

  it('maps validation failures to BAD_USER_INPUT', async () => {
    await expect(
      userResolvers.Mutation.userUpdateProfile(null, { input: { name: '   ' } }, ctx as never),
    ).rejects.toSatisfy(err => (err as GraphQLError).extensions?.code === 'BAD_USER_INPUT');
  });
});
