import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  CannotRemoveSelfError,
  InvalidRoleError,
  InvalidUrlKeyError,
  LastOwnerError,
  MemberNotFoundError,
  OrganizationService,
  OwnerRoleRequiredError,
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

    const result = await svc.updateMemberRole(TEST_ORG.id, TEST_USER.id, 'admin', 'owner');

    expect(result.role).toBe('admin');
  });

  it('rejects roles outside the documented set', async () => {
    await expect(
      svc.updateMemberRole(TEST_ORG.id, TEST_USER.id, 'superuser', 'owner'),
    ).rejects.toBeInstanceOf(InvalidRoleError);

    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('throws MemberNotFoundError when the user is not in the org', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    await expect(
      svc.updateMemberRole(TEST_ORG.id, 'unknown-user', 'admin', 'owner'),
    ).rejects.toBeInstanceOf(MemberNotFoundError);

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

describe('OrganizationService owner guards', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationService;
  const OTHER_USER = 'user-2';

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationService(prisma as never);
    prisma.organizationMember.update.mockResolvedValue({ role: 'admin' });
  });

  it('refuses to let an admin grant ownership', async () => {
    // Privilege escalation: requireOrgRole(['owner','admin']) alone let an
    // admin promote a second account of theirs to owner.
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'member' });

    await expect(
      svc.updateMemberRole(TEST_ORG.id, OTHER_USER, 'owner', 'admin'),
    ).rejects.toBeInstanceOf(OwnerRoleRequiredError);
    expect(prisma.organizationMember.update).not.toHaveBeenCalled();
  });

  it('refuses to let an admin demote an owner', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });

    await expect(
      svc.updateMemberRole(TEST_ORG.id, OTHER_USER, 'member', 'admin'),
    ).rejects.toBeInstanceOf(OwnerRoleRequiredError);
  });

  it('lets an owner grant ownership', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'member' });
    prisma.organizationMember.update.mockResolvedValue({ role: 'owner' });

    await expect(svc.updateMemberRole(TEST_ORG.id, OTHER_USER, 'owner', 'owner')).resolves.toEqual({
      role: 'owner',
    });
  });

  it('refuses to demote the last owner', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });
    prisma.organizationMember.count.mockResolvedValue(0); // no other owners

    await expect(
      svc.updateMemberRole(TEST_ORG.id, OTHER_USER, 'admin', 'owner'),
    ).rejects.toBeInstanceOf(LastOwnerError);
  });
});

describe('OrganizationService.removeMember', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationService;
  const ACTOR = { role: 'admin', userId: TEST_USER.id };
  const TARGET = 'user-2';

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationService(prisma as never);
    prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm2', role: 'member' });
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 3 });
    prisma.organizationMember.delete.mockResolvedValue({ id: 'm2', role: 'member' });
  });

  it('drops the org membership and every team membership inside it', async () => {
    const removed = await svc.removeMember(TEST_ORG.id, TARGET, ACTOR);

    expect(removed).toEqual({ id: 'm2', role: 'member' });
    expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({
      where: { team: { organizationId: TEST_ORG.id }, userId: TARGET },
    });
    expect(prisma.organizationMember.delete).toHaveBeenCalled();
  });

  it('never touches the global user.active flag', async () => {
    // Removing someone from one workspace must not sign them out of their
    // others — that is what SCIM's org-scoped deprovisioning gets right too.
    await svc.removeMember(TEST_ORG.id, TARGET, ACTOR);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses self-removal', async () => {
    await expect(svc.removeMember(TEST_ORG.id, TEST_USER.id, ACTOR)).rejects.toBeInstanceOf(
      CannotRemoveSelfError,
    );
    expect(prisma.organizationMember.delete).not.toHaveBeenCalled();
  });

  it('reports a target who is not a member', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);

    await expect(svc.removeMember(TEST_ORG.id, TARGET, ACTOR)).rejects.toBeInstanceOf(
      MemberNotFoundError,
    );
  });

  it('refuses to let an admin remove an owner', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm2', role: 'owner' });

    await expect(svc.removeMember(TEST_ORG.id, TARGET, ACTOR)).rejects.toBeInstanceOf(
      OwnerRoleRequiredError,
    );
  });

  it('refuses to remove the last owner even for an owner', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({ id: 'm2', role: 'owner' });
    prisma.organizationMember.count.mockResolvedValue(0);

    await expect(
      svc.removeMember(TEST_ORG.id, TARGET, { role: 'owner', userId: TEST_USER.id }),
    ).rejects.toBeInstanceOf(LastOwnerError);
  });
});
