import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  InvalidRoleError,
  InvalidUrlKeyError,
  MemberNotFoundError,
  OrganizationService,
  UrlKeyTakenError,
} from './organization.service';

describe('OrganizationService.createWithOwner', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationService(prisma as never);
  });

  it('creates the org and founding owner membership in one transaction', async () => {
    prisma.organization.create.mockResolvedValue(TEST_ORG);
    prisma.organizationMember.create.mockResolvedValue({});

    const org = await svc.createWithOwner(TEST_USER.id, {
      name: 'Acme',
      urlKey: 'acme',
    });

    expect(org).toEqual(TEST_ORG);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    // Both writes happen via the tx client passed into the callback.
    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Acme', urlKey: 'acme' },
      }),
    );
    expect(prisma.organizationMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'owner', userId: TEST_USER.id }),
      }),
    );
  });

  it('rejects URL keys that violate the slug shape before touching the DB', async () => {
    await expect(
      svc.createWithOwner(TEST_USER.id, { name: 'Acme', urlKey: 'NoCaps' }),
    ).rejects.toBeInstanceOf(InvalidUrlKeyError);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('translates Prisma P2002 unique-constraint into UrlKeyTakenError', async () => {
    const p2002 = Object.assign(Object.create(Prisma.PrismaClientKnownRequestError.prototype), {
      code: 'P2002',
      message: 'Unique constraint failed',
    }) as Prisma.PrismaClientKnownRequestError;

    prisma.$transaction.mockRejectedValue(p2002);

    await expect(
      svc.createWithOwner(TEST_USER.id, { name: 'Acme', urlKey: 'acme' }),
    ).rejects.toBeInstanceOf(UrlKeyTakenError);
  });

  it('lets non-P2002 Prisma errors bubble up unchanged', async () => {
    const other = new Error('connection lost');
    prisma.$transaction.mockRejectedValue(other);

    await expect(svc.createWithOwner(TEST_USER.id, { name: 'Acme', urlKey: 'acme' })).rejects.toBe(
      other,
    );
  });
});

describe('OrganizationService.updateMemberRole', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationService(prisma as never);
  });

  it('updates the role and returns the new membership row', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({
      id: 'm1',
      organizationId: TEST_ORG.id,
      role: 'member',
      userId: TEST_USER.id,
    });
    prisma.organizationMember.update.mockResolvedValue({
      id: 'm1',
      organizationId: TEST_ORG.id,
      role: 'admin',
      userId: TEST_USER.id,
    });

    const result = await svc.updateMemberRole(TEST_ORG.id, TEST_USER.id, 'admin');

    expect(result.role).toBe('admin');
  });

  it('rejects roles outside the documented set', async () => {
    await expect(
      svc.updateMemberRole(TEST_ORG.id, TEST_USER.id, 'superuser'),
    ).rejects.toBeInstanceOf(InvalidRoleError);

    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('throws MemberNotFoundError when the user is not in the org', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    await expect(svc.updateMemberRole(TEST_ORG.id, 'unknown-user', 'admin')).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );

    expect(prisma.organizationMember.update).not.toHaveBeenCalled();
  });
});

describe('OrganizationService — small finders', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationService(prisma as never);
  });

  it('isMember returns true when the membership row exists', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm1' });
    await expect(svc.isMember(TEST_ORG.id, TEST_USER.id)).resolves.toBe(true);
  });

  it('isMember returns false when the membership row is missing', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    await expect(svc.isMember(TEST_ORG.id, TEST_USER.id)).resolves.toBe(false);
  });

  it('getMemberRole returns the role string for a member', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'admin' });
    await expect(svc.getMemberRole(TEST_ORG.id, TEST_USER.id)).resolves.toBe('admin');
  });

  it('getMemberRole returns null for a non-member', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    await expect(svc.getMemberRole(TEST_ORG.id, 'nobody')).resolves.toBeNull();
  });
});
