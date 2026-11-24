import type { GraphQLError } from 'graphql';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext, type MockGraphQLContext } from '@/test/context-mock';
import { TEST_ORG, TEST_USER } from '@/test/fixtures';
import { USER_SYNC_OMIT } from '../../services/sync.service';
import { userResolvers } from './user';

const OTHER_ORG = { ...TEST_ORG, id: '00000000-0000-0000-0000-0000000000f2', urlKey: 'other' };

describe('userUpdateProfile', () => {
  let ctx: MockGraphQLContext;
  const stored = { ...TEST_USER, name: 'Old Name' };

  beforeEach(() => {
    ctx = createMockContext();
    ctx.prisma.user.update.mockImplementation(async ({ data }: { data: object }) => ({
      ...stored,
      ...data,
    }));
    ctx.prisma.user.findUnique.mockResolvedValue(stored);
    ctx.prisma.organizationMember.findMany.mockResolvedValue([
      { organization: TEST_ORG, role: 'member' },
      { organization: OTHER_ORG, role: 'member' },
    ]);
  });

  function recordSpy() {
    // A distinct id per workspace, so `lastSyncId` proves the CURRENT org's
    // action is the one returned (not just "some action").
    const ids = new Map([
      [TEST_ORG.id, BigInt(11)],
      [OTHER_ORG.id, BigInt(22)],
    ]);
    return vi
      .spyOn(ctx.services.sync, 'recordSyncAction')
      .mockImplementation(
        async (_c, orgId) => ({ id: ids.get(orgId), organizationId: orgId }) as never,
      );
  }

  it('announces a User SyncAction in every workspace, atomically with the update', async () => {
    const spy = recordSpy();
    const publish = vi.spyOn(ctx.services.sync, 'publish');

    const result = await userResolvers.Mutation.userUpdateProfile(
      null,
      { input: { name: 'Ada Lovelace' } },
      ctx as never,
    );

    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls.map(c => [c[1], c[2], c[3]])).toEqual([
      [TEST_ORG.id, 'U', 'User'],
      [OTHER_ORG.id, 'U', 'User'],
    ]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(result.lastSyncId).toBe('11');
    expect(result.success).toBe(true);
  });

  it('publishes nothing when the fan-out fails part-way (the transaction rolls back)', async () => {
    const spy = recordSpy();
    spy.mockImplementationOnce(
      async (_c, orgId) => ({ id: BigInt(1), organizationId: orgId }) as never,
    );
    spy.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const publish = vi.spyOn(ctx.services.sync, 'publish');

    await expect(
      userResolvers.Mutation.userUpdateProfile(null, { input: { name: 'Ada' } }, ctx as never),
    ).rejects.toThrow('boom');
    expect(publish).not.toHaveBeenCalled();
  });

  it('never broadcasts sensitive columns', async () => {
    recordSpy();
    await userResolvers.Mutation.userUpdateProfile(null, { input: { name: 'Ada' } }, ctx as never);
    // The broadcast row is read with the shared omit list; assert the exact
    // contract so deleting `omit` (or a column from it) turns this red.
    const broadcastRead = ctx.prisma.user.findUnique.mock.calls.find(
      c => (c[0] as { omit?: unknown }).omit,
    );
    expect(broadcastRead?.[0].omit).toEqual(USER_SYNC_OMIT);
    for (const col of [
      'calendarFeedToken',
      'isPlatformAdmin',
      'passwordHash',
      'googleId',
      'githubId',
    ]) {
      expect(broadcastRead?.[0].omit).toHaveProperty(col, true);
    }
  });

  it('is a no-op (no SyncActions) when nothing changed', async () => {
    const spy = recordSpy();
    const result = await userResolvers.Mutation.userUpdateProfile(
      null,
      { input: { name: 'Old Name' } },
      ctx as never,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.lastSyncId).toBeNull();
  });

  it.each([
    ['blank name', { name: '   ' }],
    ['null name', { name: null }],
    ['empty input', {}],
    ['external avatar', { avatarUrl: 'https://evil.example/x.png' }],
  ])('maps %s to BAD_USER_INPUT', async (_l, input) => {
    await expect(
      userResolvers.Mutation.userUpdateProfile(null, { input }, ctx as never),
    ).rejects.toSatisfy(err => (err as GraphQLError).extensions?.code === 'BAD_USER_INPUT');
  });
});
