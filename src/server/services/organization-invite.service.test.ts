import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendInviteEmail = vi.fn();
vi.mock('../lib/email', () => ({
  sendOrganizationInviteEmail: (...args: unknown[]) => sendInviteEmail(...args),
}));

import { TEST_ORG, TEST_USER } from '@/test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '@/test/prisma-mock';
import { InvalidRoleError } from './organization.service';
import {
  AlreadyMemberError,
  hashInviteToken,
  InvalidInviteEmailError,
  InviteEmailFailedError,
  InviteEmailMismatchError,
  InviteNotFoundError,
  InviteRoleNotAllowedError,
  MAX_PENDING_INVITES,
  OrganizationInviteService,
  TooManyInvitesError,
} from './organization-invite.service';

const OWNER = { actorRole: 'owner', invitedById: TEST_USER.id, orgId: TEST_ORG.id };

describe('OrganizationInviteService.create', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationInviteService;

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationInviteService(prisma as never);
    prisma.organizationMember.findFirst.mockResolvedValue(null);
    prisma.organizationInvite.count.mockResolvedValue(0);
    prisma.organizationInvite.updateMany.mockResolvedValue({ count: 0 });
    prisma.organizationInvite.create.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: 'invite-1',
      ...(data as object),
    }));
    // `create` now resolves the org name and inviter for the email it sends.
    prisma.organization.findUnique.mockResolvedValue({ name: 'Acme' });
    prisma.user.findUnique.mockResolvedValue({ displayName: 'Ada', locale: 'en', name: 'Ada' });
    sendInviteEmail.mockReset();
    sendInviteEmail.mockResolvedValue(undefined);
  });

  it('stores only the token hash and puts the raw token solely in the email', async () => {
    const invite = await svc.create({
      ...OWNER,
      email: 'New@Example.com',
      role: 'member',
    });

    const inviteUrl = sendInviteEmail.mock.calls[0]?.[0]?.inviteUrl as string;
    const token = inviteUrl.split('/').pop() as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // The raw token must never be persisted — the email is its only home.
    expect(invite.tokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(invite)).not.toContain(token);
  });

  it('revokes the invitation when the email cannot be delivered', async () => {
    // An undelivered invitation is permanently unusable (the row holds only
    // the hash) but would otherwise sit in the pending list looking healthy.
    sendInviteEmail.mockRejectedValue(new Error('smtp down'));
    prisma.organizationInvite.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      svc.create({ ...OWNER, email: 'undeliverable@example.com', role: 'member' }),
    ).rejects.toBeInstanceOf(InviteEmailFailedError);

    expect(prisma.organizationInvite.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'invite-1' }) }),
    );
  });

  it('lowercases the email so acceptance can compare case-insensitively', async () => {
    const invite = await svc.create({ ...OWNER, email: '  Mixed@Case.COM ', role: 'member' });

    expect(invite.email).toBe('mixed@case.com');
  });

  it('revokes any outstanding invitation for the same address first', async () => {
    // Re-inviting must not leave two live links for one mailbox — the older
    // one has to stop working the moment the new mail goes out.
    await svc.create({ ...OWNER, email: 'again@example.com', role: 'member' });

    expect(prisma.organizationInvite.updateMany).toHaveBeenCalledWith({
      data: { revokedAt: expect.any(Date) },
      where: {
        acceptedAt: null,
        email: 'again@example.com',
        organizationId: TEST_ORG.id,
        revokedAt: null,
      },
    });
  });

  it('rejects a malformed email before touching the database', async () => {
    await expect(
      svc.create({ ...OWNER, email: 'not-an-email', role: 'member' }),
    ).rejects.toBeInstanceOf(InvalidInviteEmailError);
    expect(prisma.organizationInvite.create).not.toHaveBeenCalled();
  });

  it('rejects a role outside the documented set', async () => {
    // Distinctly from a bad email — the two used to share one error, so an
    // invalid role told the admin "a valid email address is required".
    await expect(
      svc.create({ ...OWNER, email: 'a@b.com', role: 'superuser' }),
    ).rejects.toBeInstanceOf(InvalidRoleError);
  });

  it('lets only an owner invite another owner', async () => {
    // Without this an admin could invite a throwaway address as owner and
    // escalate past the role they were given.
    await expect(
      svc.create({ ...OWNER, actorRole: 'admin', email: 'a@b.com', role: 'owner' }),
    ).rejects.toBeInstanceOf(InviteRoleNotAllowedError);

    await expect(svc.create({ ...OWNER, email: 'a@b.com', role: 'owner' })).resolves.toBeDefined();
  });

  it('refuses to invite someone who is already a member', async () => {
    prisma.organizationMember.findFirst.mockResolvedValue({ id: 'm1' });

    await expect(
      svc.create({ ...OWNER, email: 'existing@example.com', role: 'member' }),
    ).rejects.toBeInstanceOf(AlreadyMemberError);
  });

  it('caps outstanding invitations', async () => {
    prisma.organizationInvite.count.mockResolvedValue(MAX_PENDING_INVITES);

    await expect(svc.create({ ...OWNER, email: 'a@b.com', role: 'member' })).rejects.toBeInstanceOf(
      TooManyInvitesError,
    );
  });
});

describe('OrganizationInviteService.accept', () => {
  let prisma: MockPrismaClient;
  let svc: OrganizationInviteService;

  const liveInvite = {
    email: 'invited@example.com',
    id: 'invite-1',
    organization: { id: TEST_ORG.id, name: 'Acme', urlKey: 'acme' },
    organizationId: TEST_ORG.id,
    role: 'admin',
  };

  beforeEach(() => {
    prisma = createMockPrisma();
    svc = new OrganizationInviteService(prisma as never);
    prisma.organizationInvite.findFirst.mockResolvedValue(liveInvite);
    prisma.organizationInvite.updateMany.mockResolvedValue({ count: 1 });
    prisma.organizationMember.upsert.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue({ email: 'invited@example.com' });
  });

  it('grants the invited role and marks the invitation spent', async () => {
    const result = await svc.accept('raw-token', TEST_USER.id);

    expect(result).toEqual({ organization: liveInvite.organization, role: 'admin' });
    expect(prisma.organizationMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { organizationId: TEST_ORG.id, role: 'admin', userId: TEST_USER.id },
      }),
    );
  });

  it('claims atomically so two concurrent acceptances cannot both win', async () => {
    // The guard is the `acceptedAt: null` scope on the update, not a
    // find-then-write — a lost race reports count 0.
    prisma.organizationInvite.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.accept('raw-token', TEST_USER.id)).rejects.toBeInstanceOf(InviteNotFoundError);
    expect(prisma.organizationMember.upsert).not.toHaveBeenCalled();
  });

  it('refuses a session whose email does not match the invitation', async () => {
    // Otherwise the link is a bearer token: whoever receives a forwarded
    // copy of the email joins the workspace.
    prisma.user.findUnique.mockResolvedValue({ email: 'someone-else@example.com' });
    await expect(svc.accept('raw-token', TEST_USER.id)).rejects.toBeInstanceOf(
      InviteEmailMismatchError,
    );
    expect(prisma.organizationInvite.updateMany).not.toHaveBeenCalled();
  });

  it('matches the email case-insensitively', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'Invited@Example.com' });
    await expect(svc.accept('raw-token', TEST_USER.id)).resolves.toBeDefined();
  });

  it('rejects a token with no live invitation behind it', async () => {
    prisma.organizationInvite.findFirst.mockResolvedValue(null);

    await expect(svc.accept('bad-token', TEST_USER.id)).rejects.toBeInstanceOf(InviteNotFoundError);
  });

  it('leaves an existing membership untouched rather than re-roling it', async () => {
    // Accepting an invitation must not silently demote someone who already
    // joined by another route while the invitation was outstanding.
    await svc.accept('raw-token', TEST_USER.id);

    expect(prisma.organizationMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });
});

describe('OrganizationInviteService.revoke', () => {
  it('scopes the revoke to the caller’s org', async () => {
    const prisma = createMockPrisma();
    const svc = new OrganizationInviteService(prisma as never);
    prisma.organizationInvite.updateMany.mockResolvedValue({ count: 1 });

    await expect(svc.revoke(TEST_ORG.id, 'invite-1')).resolves.toBe(true);
    expect(prisma.organizationInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'invite-1', organizationId: TEST_ORG.id }),
      }),
    );
  });

  it('reports false when nothing matched', async () => {
    const prisma = createMockPrisma();
    const svc = new OrganizationInviteService(prisma as never);
    prisma.organizationInvite.updateMany.mockResolvedValue({ count: 0 });

    await expect(svc.revoke(TEST_ORG.id, 'someone-elses-invite')).resolves.toBe(false);
  });
});
