import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  ImpersonationTargetError,
  InvalidTenantLimitsError,
  LastPlatformAdminError,
  PlatformAdminService,
  type TenantLimits,
  TenantNotFoundError,
} from './platform-admin.service';

const VALID_LIMITS: TenantLimits = {
  maxCustomFieldsPerOrg: 30,
  maxCustomFieldsPerTeam: 20,
  maxExportRows: 10000,
  maxInitiativeDepth: 5,
  maxLabelGroupChildren: 250,
};

describe('PlatformAdminService', () => {
  let prisma: MockPrismaClient;
  let service: PlatformAdminService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new PlatformAdminService(prisma as never);
  });

  describe('setPlatformAdmin', () => {
    it('refuses to revoke the last remaining platform admin', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1' }) // assertUserExists
        .mockResolvedValueOnce({ isPlatformAdmin: true }); // target lookup
      prisma.user.count.mockResolvedValue(1);

      await expect(service.setPlatformAdmin('u1', false)).rejects.toBeInstanceOf(
        LastPlatformAdminError,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('revokes admin when another admin remains', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce({ isPlatformAdmin: true });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue({ id: 'u1', isPlatformAdmin: false });

      await service.setPlatformAdmin('u1', false);
      expect(prisma.user.update).toHaveBeenCalledWith({
        data: { isPlatformAdmin: false },
        where: { id: 'u1' },
      });
    });

    it('grants admin without the last-admin check', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ id: 'u1', isPlatformAdmin: true });

      await service.setPlatformAdmin('u1', true);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('setUserActive', () => {
    it('refuses to suspend the last active platform admin', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1' }) // assertUserExists
        .mockResolvedValueOnce({ isPlatformAdmin: true }); // target lookup
      prisma.user.count.mockResolvedValue(1); // active admins

      await expect(service.setUserActive('u1', false)).rejects.toBeInstanceOf(
        LastPlatformAdminError,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('suspends an admin when another active admin remains', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce({ isPlatformAdmin: true });
      prisma.user.count.mockResolvedValue(2);
      prisma.user.update.mockResolvedValue({ active: false, id: 'u1' });

      await service.setUserActive('u1', false);
      expect(prisma.user.update).toHaveBeenCalledWith({
        data: { active: false },
        where: { id: 'u1' },
      });
    });

    it('suspends a non-admin without the last-admin check', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1' })
        .mockResolvedValueOnce({ isPlatformAdmin: false });
      prisma.user.update.mockResolvedValue({ active: false, id: 'u1' });

      await service.setUserActive('u1', false);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('reactivating skips the guard entirely', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ active: true, id: 'u1' });

      await service.setUserActive('u1', true);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });
  });

  describe('resolveImpersonationTarget', () => {
    it('throws when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resolveImpersonationTarget('missing')).rejects.toBeInstanceOf(
        ImpersonationTargetError,
      );
    });

    it('throws when the user is suspended', async () => {
      prisma.user.findUnique.mockResolvedValue({ active: false, id: 'u1' });
      await expect(service.resolveImpersonationTarget('u1')).rejects.toThrow(/suspended user/i);
    });

    it('throws when the user is not a member of the target org', async () => {
      prisma.user.findUnique.mockResolvedValue({ active: true, id: 'u1' });
      prisma.organizationMember.findFirst.mockResolvedValue(null);
      await expect(service.resolveImpersonationTarget('u1', 'org1')).rejects.toThrow(
        /not a member/i,
      );
    });

    it('throws when the target org is suspended', async () => {
      prisma.user.findUnique.mockResolvedValue({ active: true, id: 'u1' });
      prisma.organizationMember.findFirst.mockResolvedValue({
        organization: { archivedAt: null, id: 'org1', suspendedAt: new Date() },
      });
      await expect(service.resolveImpersonationTarget('u1', 'org1')).rejects.toThrow(/suspended/i);
    });

    it('returns the resolved user and org when valid', async () => {
      const user = { active: true, id: 'u1' };
      const org = { archivedAt: null, id: 'org1', suspendedAt: null };
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.organizationMember.findFirst.mockResolvedValue({ organization: org });

      const result = await service.resolveImpersonationTarget('u1', 'org1');
      expect(result).toEqual({ org, user });
    });
  });

  describe('suspendTenant', () => {
    it('throws when the tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.suspendTenant('org1', 'spam')).rejects.toBeInstanceOf(
        TenantNotFoundError,
      );
    });

    it('stamps suspendedAt and reason', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org1' });
      prisma.organization.update.mockResolvedValue({ id: 'org1', suspendedAt: new Date() });

      await service.suspendTenant('org1', '  abuse  ');
      const arg = prisma.organization.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'org1' });
      expect(arg.data.suspendedReason).toBe('abuse');
      expect(arg.data.suspendedAt).toBeInstanceOf(Date);
    });
  });

  describe('updateTenantLimits', () => {
    it('throws when the tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.updateTenantLimits('org1', VALID_LIMITS)).rejects.toBeInstanceOf(
        TenantNotFoundError,
      );
    });

    it('writes all five caps when every value is valid', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org1' });
      prisma.organization.update.mockResolvedValue({ id: 'org1' });

      await service.updateTenantLimits('org1', VALID_LIMITS);
      const arg = prisma.organization.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'org1' });
      expect(arg.data).toEqual(VALID_LIMITS);
    });

    it('rejects a non-integer cap without writing', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org1' });
      await expect(
        service.updateTenantLimits('org1', { ...VALID_LIMITS, maxExportRows: 10.5 }),
      ).rejects.toBeInstanceOf(InvalidTenantLimitsError);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('rejects a cap below the minimum (0)', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org1' });
      await expect(
        service.updateTenantLimits('org1', { ...VALID_LIMITS, maxInitiativeDepth: 0 }),
      ).rejects.toBeInstanceOf(InvalidTenantLimitsError);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('rejects a cap above the per-field ceiling', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org1' });
      await expect(
        service.updateTenantLimits('org1', { ...VALID_LIMITS, maxInitiativeDepth: 21 }),
      ).rejects.toBeInstanceOf(InvalidTenantLimitsError);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });
  });
});
