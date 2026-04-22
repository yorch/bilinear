import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_USER } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import { signRefreshToken } from '../lib/jwt';
import { AuthService, InvalidTokenError } from './auth.service';
import { UserService } from './user.service';

const FAMILY_ID = '00000000-0000-0000-0000-000000000aaa';
const TOKEN_ID = '00000000-0000-0000-0000-000000000bbb';

function makeTokenRow(
  overrides: Partial<{
    familyId: string | null;
    expiresAt: Date;
    revokedAt: Date | null;
  }> = {},
) {
  return {
    createdAt: new Date('2026-04-22T10:00:00Z'),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    familyId: FAMILY_ID,
    id: TOKEN_ID,
    ipAddress: null,
    label: null,
    lastUsedAt: null,
    revokedAt: null,
    tokenHash: '',
    type: 'refresh' as const,
    userAgent: null,
    userId: TEST_USER.id,
    ...overrides,
  };
}

async function signValidRefreshToken() {
  return signRefreshToken({ tokenId: TOKEN_ID, userId: TEST_USER.id });
}

describe('AuthService.refreshTokens — family + reuse detection', () => {
  let prisma: MockPrismaClient;
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    const userService = new UserService(prisma as never);
    // Avoid the real DB lookup for user → org
    vi.spyOn(userService, 'getOrganizationForUser').mockResolvedValue(null);
    service = new AuthService(prisma as never, userService);
  });

  it('rotates within the same family when the token is in the grace window', async () => {
    const rawToken = await signValidRefreshToken();
    // revokedAt = 10 min in the future (within the 30-min grace window)
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({ revokedAt: new Date(Date.now() + 10 * 60 * 1000) }),
    );
    prisma.authToken.update.mockResolvedValue({});
    prisma.authToken.create.mockResolvedValue({});

    const result = await service.refreshTokens(rawToken);

    expect(result.success).toBe(true);
    // New refresh row inherits the existing family id
    expect(prisma.authToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ familyId: FAMILY_ID, type: 'refresh' }),
      }),
    );
    // No family revoke on a normal rotation
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });

  it('revokes the whole family when a token is replayed after the grace window', async () => {
    const rawToken = await signValidRefreshToken();
    // revokedAt is in the past → this is a post-grace replay (reuse)
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({ revokedAt: new Date(Date.now() - 60 * 1000) }),
    );
    prisma.authToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );

    // Every active descendant of the family revoked in one sweep
    expect(prisma.authToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          familyId: FAMILY_ID,
          revokedAt: null,
          type: 'refresh',
        }),
      }),
    );
    // No new token issued
    expect(prisma.authToken.create).not.toHaveBeenCalled();
    // The presented token itself isn't re-revoked individually
    expect(prisma.authToken.update).not.toHaveBeenCalled();
  });

  it('rejects reuse without calling updateMany when the token pre-dates the family migration', async () => {
    const rawToken = await signValidRefreshToken();
    // Legacy token issued before the family_id migration
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({
        familyId: null,
        revokedAt: new Date(Date.now() - 60 * 1000),
      }),
    );

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );

    // Nothing to sweep — the legacy token has no family to kill
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('rejects natural expiry without revoking the family', async () => {
    const rawToken = await signValidRefreshToken();
    // expiresAt in the past → natural 30-day expiry, not reuse
    prisma.authToken.findFirst.mockResolvedValue(
      makeTokenRow({
        expiresAt: new Date(Date.now() - 60 * 1000),
        revokedAt: null,
      }),
    );

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );

    // Family stays alive — natural expiry on one token isn't an attack signal
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('rejects unknown token IDs without touching the family', async () => {
    const rawToken = await signValidRefreshToken();
    prisma.authToken.findFirst.mockResolvedValue(null);

    await expect(service.refreshTokens(rawToken)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );

    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
    expect(prisma.authToken.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed refresh JWT', async () => {
    await expect(
      service.refreshTokens('not-a-real-jwt'),
    ).rejects.toBeInstanceOf(InvalidTokenError);

    expect(prisma.authToken.findFirst).not.toHaveBeenCalled();
    expect(prisma.authToken.updateMany).not.toHaveBeenCalled();
  });
});
