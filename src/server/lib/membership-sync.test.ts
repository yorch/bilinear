import { describe, expect, it, vi } from 'vitest';
import { type OrganizationRole, Prisma } from '../../generated/prisma';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma } from '../../test/prisma-mock';
import {
  announceJoin,
  broadcastMembership,
  ensureMembership,
  joinOrganization,
} from './membership-sync';

const MEMBERSHIP = {
  createdAt: new Date('2026-08-02T00:00:00Z'),
  id: 'mem-1',
  organizationId: TEST_ORG.id,
  role: 'member' as OrganizationRole,
  updatedAt: new Date('2026-08-02T00:00:00Z'),
  userId: TEST_USER.id,
};

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    clientVersion: 'test',
    code: 'P2002',
  });
}

function fakeSync() {
  return { createSyncAction: vi.fn().mockResolvedValue({ id: BigInt(3) }) };
}

describe('ensureMembership', () => {
  it('creates the membership and reports it as new', async () => {
    const prisma = createMockPrisma();
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    prisma.organizationMember.create.mockResolvedValue(MEMBERSHIP);

    const result = await ensureMembership(prisma as never, TEST_ORG.id, TEST_USER.id, 'member');

    expect(result).toEqual({ created: true, membership: MEMBERSHIP });
    expect(prisma.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: TEST_ORG.id, role: 'member', userId: TEST_USER.id },
    });
  });

  it('leaves an existing membership at its current role', async () => {
    // The callers all mean "make sure they are in", never "set their role" —
    // an invitation must not demote someone who is already an owner.
    const prisma = createMockPrisma();
    const owner = { ...MEMBERSHIP, role: 'owner' as OrganizationRole };
    prisma.organizationMember.findUnique.mockResolvedValue(owner);

    const result = await ensureMembership(prisma as never, TEST_ORG.id, TEST_USER.id, 'member');

    expect(result).toEqual({ created: false, membership: owner });
    expect(prisma.organizationMember.create).not.toHaveBeenCalled();
  });

  it('reports the loser of a concurrent join as not-created', async () => {
    // Two joins race past the read; the unique constraint picks a winner. The
    // loser must not claim a creation, or both would broadcast an 'I' for one
    // membership.
    const prisma = createMockPrisma();
    prisma.organizationMember.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(MEMBERSHIP);
    prisma.organizationMember.create.mockRejectedValue(p2002());

    const result = await ensureMembership(prisma as never, TEST_ORG.id, TEST_USER.id, 'member');

    expect(result).toEqual({ created: false, membership: MEMBERSHIP });
  });

  it('rethrows a constraint violation it cannot explain', async () => {
    const prisma = createMockPrisma();
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    prisma.organizationMember.create.mockRejectedValue(p2002());

    await expect(
      ensureMembership(prisma as never, TEST_ORG.id, TEST_USER.id, 'member'),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  });

  it('rethrows anything that is not a uniqueness conflict', async () => {
    const prisma = createMockPrisma();
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    prisma.organizationMember.create.mockRejectedValue(new Error('connection lost'));

    await expect(
      ensureMembership(prisma as never, TEST_ORG.id, TEST_USER.id, 'member'),
    ).rejects.toThrow('connection lost');
  });
});

describe('broadcastMembership', () => {
  it('emits under the model name and id clients key the roster by', async () => {
    const sync = fakeSync();

    await broadcastMembership(sync, TEST_ORG.id, 'D', MEMBERSHIP);

    expect(sync.createSyncAction).toHaveBeenCalledWith(
      TEST_ORG.id,
      'D',
      'OrganizationMember',
      'mem-1',
      MEMBERSHIP,
    );
  });
});

describe('announceJoin', () => {
  it('ships the user row before the membership that points at it', async () => {
    // A membership 'I' alone is inert for a join: the bootstrap scopes `users`
    // to current members, so a client that was already running has no
    // `UserStore` row for the new person and the members list — an
    // intersection of the two pools — simply never shows them.
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ email: 'new@example.com', id: TEST_USER.id });
    const sync = fakeSync();

    await announceJoin(prisma as never, sync, TEST_ORG.id, MEMBERSHIP);

    expect(sync.createSyncAction.mock.calls.map(c => [c[1], c[2]])).toEqual([
      ['I', 'User'],
      ['I', 'OrganizationMember'],
    ]);
  });

  it('omits the columns that must never reach another member’s IndexedDB', async () => {
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id });

    await announceJoin(prisma as never, fakeSync(), TEST_ORG.id, MEMBERSHIP);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        omit: expect.objectContaining({
          calendarFeedToken: true,
          githubId: true,
          googleId: true,
          isPlatformAdmin: true,
          passwordHash: true,
        }),
      }),
    );
  });

  it('still announces the membership when the user row has vanished', async () => {
    // Nothing should be able to swallow the roster change; a missing user row
    // is a degraded display, not a reason to drop the membership entirely.
    const prisma = createMockPrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    const sync = fakeSync();

    await announceJoin(prisma as never, sync, TEST_ORG.id, MEMBERSHIP);

    expect(sync.createSyncAction).toHaveBeenCalledTimes(1);
    expect(sync.createSyncAction).toHaveBeenCalledWith(
      TEST_ORG.id,
      'I',
      'OrganizationMember',
      'mem-1',
      MEMBERSHIP,
    );
  });
});

describe('joinOrganization', () => {
  it('writes and announces in one step', async () => {
    const prisma = createMockPrisma();
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    prisma.organizationMember.create.mockResolvedValue(MEMBERSHIP);
    prisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id });
    const sync = fakeSync();

    const result = await joinOrganization(
      prisma as never,
      sync,
      TEST_ORG.id,
      TEST_USER.id,
      'member',
    );

    expect(result.created).toBe(true);
    expect(sync.createSyncAction.mock.calls.map(c => [c[1], c[2]])).toEqual([
      ['I', 'User'],
      ['I', 'OrganizationMember'],
    ]);
  });

  it('announces nothing when the person was already a member', async () => {
    const prisma = createMockPrisma();
    prisma.organizationMember.findUnique.mockResolvedValue(MEMBERSHIP);
    const sync = fakeSync();

    const result = await joinOrganization(
      prisma as never,
      sync,
      TEST_ORG.id,
      TEST_USER.id,
      'member',
    );

    expect(result.created).toBe(false);
    expect(sync.createSyncAction).not.toHaveBeenCalled();
  });
});
