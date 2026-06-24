import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import { ScimService, ScimTokenNotFoundError } from './scim.service';

const TEST_TOKEN_ID = '00000000-0000-0000-0000-000000000700';

const TEST_SCIM_TOKEN = {
  createdAt: new Date('2026-03-01T00:00:00Z'),
  createdById: TEST_USER.id,
  id: TEST_TOKEN_ID,
  label: 'Okta provisioning',
  lastUsedAt: null,
  organizationId: TEST_ORG.id,
  revokedAt: null,
  tokenHash: 'deadbeef',
};

describe('ScimService', () => {
  let prisma: MockPrismaClient;
  let service: ScimService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ScimService(prisma as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createToken', () => {
    it('stores only the sha256 hash and returns the plaintext once', async () => {
      prisma.scimToken.create.mockResolvedValue(TEST_SCIM_TOKEN);

      const result = await service.createToken(TEST_ORG.id, TEST_USER.id, 'Okta provisioning');

      expect(result.plaintext).toMatch(/^[0-9a-f]{64}$/);
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      expect(prisma.scimToken.create).toHaveBeenCalledTimes(1);
      const arg = prisma.scimToken.create.mock.calls[0][0];
      // Plaintext is never persisted; only its hash.
      expect(arg.data.tokenHash).toBe(createHash('sha256').update(result.plaintext).digest('hex'));
      expect(JSON.stringify(arg.data)).not.toContain(result.plaintext);
      expect(arg.data).toMatchObject({
        createdById: TEST_USER.id,
        id: result.id,
        label: 'Okta provisioning',
        organizationId: TEST_ORG.id,
      });
    });

    it('generates unique plaintext and ids across calls', async () => {
      prisma.scimToken.create.mockResolvedValue(TEST_SCIM_TOKEN);

      const a = await service.createToken(TEST_ORG.id, TEST_USER.id, 'a');
      const b = await service.createToken(TEST_ORG.id, TEST_USER.id, 'b');

      expect(a.plaintext).not.toBe(b.plaintext);
      expect(a.id).not.toBe(b.id);
    });

    it('stamps createdAt with the current time', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
      prisma.scimToken.create.mockResolvedValue(TEST_SCIM_TOKEN);

      await service.createToken(TEST_ORG.id, TEST_USER.id, 'pinned');

      const arg = prisma.scimToken.create.mock.calls[0][0];
      expect(arg.data.createdAt).toEqual(new Date('2026-06-24T12:00:00Z'));
    });
  });

  describe('revokeToken', () => {
    it('sets revokedAt scoped to the org and only for active tokens', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
      prisma.scimToken.updateMany.mockResolvedValue({ count: 1 });

      await service.revokeToken(TEST_TOKEN_ID, TEST_ORG.id);

      expect(prisma.scimToken.updateMany).toHaveBeenCalledWith({
        data: { revokedAt: new Date('2026-06-24T12:00:00Z') },
        where: { id: TEST_TOKEN_ID, organizationId: TEST_ORG.id, revokedAt: null },
      });
    });

    it('throws ScimTokenNotFoundError when nothing was updated', async () => {
      prisma.scimToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeToken(TEST_TOKEN_ID, TEST_ORG.id)).rejects.toThrow(
        ScimTokenNotFoundError,
      );
    });
  });

  describe('listTokens', () => {
    it('returns active tokens newest-first without exposing the hash', async () => {
      const row = {
        createdAt: TEST_SCIM_TOKEN.createdAt,
        id: TEST_TOKEN_ID,
        label: TEST_SCIM_TOKEN.label,
        lastUsedAt: null,
        revokedAt: null,
      };
      prisma.scimToken.findMany.mockResolvedValue([row]);

      const result = await service.listTokens(TEST_ORG.id);

      expect(result).toEqual([row]);
      expect(prisma.scimToken.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, id: true, label: true, lastUsedAt: true, revokedAt: true },
        where: { organizationId: TEST_ORG.id, revokedAt: null },
      });
    });
  });

  describe('authenticateScimToken', () => {
    it('hashes the bearer and returns the orgId on a match', async () => {
      prisma.scimToken.findFirst.mockResolvedValue(TEST_SCIM_TOKEN);
      prisma.scimToken.update.mockResolvedValue(TEST_SCIM_TOKEN);

      const result = await service.authenticateScimToken('plaintext-bearer');

      expect(result).toEqual({ orgId: TEST_ORG.id });
      expect(prisma.scimToken.findFirst).toHaveBeenCalledWith({
        where: {
          revokedAt: null,
          tokenHash: createHash('sha256').update('plaintext-bearer').digest('hex'),
        },
      });
    });

    it('updates lastUsedAt for the matched token', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-24T12:00:00Z'));
      prisma.scimToken.findFirst.mockResolvedValue(TEST_SCIM_TOKEN);
      prisma.scimToken.update.mockResolvedValue(TEST_SCIM_TOKEN);

      await service.authenticateScimToken('plaintext-bearer');

      expect(prisma.scimToken.update).toHaveBeenCalledWith({
        data: { lastUsedAt: new Date('2026-06-24T12:00:00Z') },
        where: { id: TEST_TOKEN_ID },
      });
    });

    it('returns null when no active token matches', async () => {
      prisma.scimToken.findFirst.mockResolvedValue(null);

      const result = await service.authenticateScimToken('bad-bearer');

      expect(result).toBeNull();
      expect(prisma.scimToken.update).not.toHaveBeenCalled();
    });

    it('still authenticates when the lastUsedAt update rejects', async () => {
      prisma.scimToken.findFirst.mockResolvedValue(TEST_SCIM_TOKEN);
      prisma.scimToken.update.mockRejectedValue(new Error('db down'));

      const result = await service.authenticateScimToken('plaintext-bearer');

      expect(result).toEqual({ orgId: TEST_ORG.id });
    });
  });
});
