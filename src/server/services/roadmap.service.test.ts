import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/rate-limit', () => ({ checkFixedWindow: vi.fn() }));
const warn = vi.hoisted(() => vi.fn());
vi.mock('../lib/logger', () => ({
  childLogger: () => ({ error: vi.fn(), info: vi.fn(), warn }),
  logger: { error: vi.fn(), info: vi.fn(), warn },
}));

import { createMockPrisma } from '@/test/prisma-mock';
import { checkFixedWindow } from '../middleware/rate-limit';
import {
  hashRoadmapPassword,
  isRoadmapUnlockTokenValid,
  RoadmapPasswordError,
  RoadmapService,
  RoadmapSlugConflictError,
  RoadmapSlugInvalidError,
  resetUnknownIpWarning,
  roadmapUnlockToken,
  verifyRoadmapPassword,
} from './roadmap.service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const URL_KEY = 'test-org';
const ROADMAP_ID = '00000000-0000-0000-0000-000000000500';

const TEST_ROADMAP = {
  createdAt: new Date('2026-04-17T00:00:00Z'),
  description: null,
  enabled: true,
  id: ROADMAP_ID,
  organizationId: ORG_ID,
  passwordHash: null,
  slug: URL_KEY,
  title: 'Product Roadmap',
  updatedAt: new Date('2026-04-17T00:00:00Z'),
};

describe('hashRoadmapPassword / verifyRoadmapPassword', () => {
  it('hashes a password and verifies it correctly', async () => {
    const hash = await hashRoadmapPassword('secret123');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    await expect(verifyRoadmapPassword(hash, 'secret123')).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashRoadmapPassword('correct');
    await expect(verifyRoadmapPassword(hash, 'wrong')).resolves.toBe(false);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    const h1 = await hashRoadmapPassword('same');
    const h2 = await hashRoadmapPassword('same');
    expect(h1).not.toBe(h2);
    // Both still verify correctly
    await expect(verifyRoadmapPassword(h1, 'same')).resolves.toBe(true);
    await expect(verifyRoadmapPassword(h2, 'same')).resolves.toBe(true);
  });
});

describe('RoadmapService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: RoadmapService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new RoadmapService(prisma as never);
  });

  describe('findByOrgId', () => {
    it('returns the roadmap for an org', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(TEST_ROADMAP);
      const result = await service.findByOrgId(ORG_ID);
      expect(result).toEqual(TEST_ROADMAP);
      expect(prisma.publicRoadmap.findUnique).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID },
      });
    });

    it('returns null when not found', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(null);
      expect(await service.findByOrgId(ORG_ID)).toBeNull();
    });
  });

  describe('findBySlug', () => {
    it('finds by slug', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(TEST_ROADMAP);
      const result = await service.findBySlug(URL_KEY);
      expect(result).toEqual(TEST_ROADMAP);
      expect(prisma.publicRoadmap.findUnique).toHaveBeenCalledWith({
        where: { slug: URL_KEY },
      });
    });
  });

  describe('upsert', () => {
    it('creates a roadmap with defaults when none exists', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(null); // findByOrgId
      prisma.publicRoadmap.findFirst.mockResolvedValue(null); // slug conflict check
      prisma.publicRoadmap.create.mockResolvedValue(TEST_ROADMAP);

      const result = await service.upsert(ORG_ID, URL_KEY, {
        title: 'My Roadmap',
      });
      expect(result).toEqual(TEST_ROADMAP);
      expect(prisma.publicRoadmap.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          enabled: false,
          organizationId: ORG_ID,
          slug: URL_KEY,
          title: 'My Roadmap',
        }),
      });
    });

    it('updates an existing roadmap', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(TEST_ROADMAP);
      prisma.publicRoadmap.findFirst.mockResolvedValue(null);
      const updated = { ...TEST_ROADMAP, enabled: true };
      prisma.publicRoadmap.update.mockResolvedValue(updated);

      const result = await service.upsert(ORG_ID, URL_KEY, { enabled: true });
      expect(result.enabled).toBe(true);
      expect(prisma.publicRoadmap.update).toHaveBeenCalled();
    });

    it('throws RoadmapSlugConflictError when slug is taken by another org', async () => {
      prisma.publicRoadmap.findFirst.mockResolvedValue({
        ...TEST_ROADMAP,
        organizationId: 'other',
      });
      await expect(service.upsert(ORG_ID, URL_KEY, { slug: 'taken-slug' })).rejects.toThrow(
        RoadmapSlugConflictError,
      );
    });

    it('hashes a new password on create', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(null);
      prisma.publicRoadmap.findFirst.mockResolvedValue(null);
      prisma.publicRoadmap.create.mockResolvedValue(TEST_ROADMAP);

      await service.upsert(ORG_ID, URL_KEY, { password: 'mypassword' });

      const createCall = prisma.publicRoadmap.create.mock.calls[0][0];
      expect(createCall.data.passwordHash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    });

    it('clears the password when empty string is passed', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(TEST_ROADMAP);
      prisma.publicRoadmap.findFirst.mockResolvedValue(null);
      prisma.publicRoadmap.update.mockResolvedValue({
        ...TEST_ROADMAP,
        passwordHash: null,
      });

      await service.upsert(ORG_ID, URL_KEY, { password: '' });

      const updateCall = prisma.publicRoadmap.update.mock.calls[0][0];
      expect(updateCall.data.passwordHash).toBeNull();
    });

    it('does not touch passwordHash when password is not provided', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(TEST_ROADMAP);
      prisma.publicRoadmap.findFirst.mockResolvedValue(null);
      prisma.publicRoadmap.update.mockResolvedValue(TEST_ROADMAP);

      await service.upsert(ORG_ID, URL_KEY, { title: 'New Title' });

      const updateCall = prisma.publicRoadmap.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('passwordHash');
    });
  });

  describe('verifyPassword', () => {
    it('returns true when roadmap has no password', async () => {
      const result = await service.verifyPassword(TEST_ROADMAP, 'anything');
      expect(result).toBe(true);
    });

    it('returns true for a correct password', async () => {
      const hash = await hashRoadmapPassword('correct');
      const roadmapWithPw = { ...TEST_ROADMAP, passwordHash: hash };
      await expect(service.verifyPassword(roadmapWithPw, 'correct')).resolves.toBe(true);
    });

    it('returns false for an incorrect password', async () => {
      const hash = await hashRoadmapPassword('correct');
      const roadmapWithPw = { ...TEST_ROADMAP, passwordHash: hash };
      await expect(service.verifyPassword(roadmapWithPw, 'wrong')).resolves.toBe(false);
    });
  });

  describe('getRoadmapProjects', () => {
    it('throws RoadmapNotFoundError when roadmap is not enabled', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue({
        ...TEST_ROADMAP,
        enabled: false,
      });
      const { RoadmapNotFoundError } = await import('./roadmap.service');
      await expect(service.getRoadmapProjects(ORG_ID)).rejects.toThrow(RoadmapNotFoundError);
    });

    it('returns projects that are roadmap-visible', async () => {
      prisma.publicRoadmap.findUnique.mockResolvedValue(TEST_ROADMAP);
      prisma.project.findMany.mockResolvedValue([
        {
          color: '#6366f1',
          health: 'onTrack',
          icon: null,
          id: 'proj-1',
          milestones: [],
          name: 'Alpha',
          progress: 0.5,
          statusName: null,
          statusType: 'inProgress',
          targetDate: null,
        },
      ]);

      // Progress is computed from the issue set, not read off the (never
      // written) `Project.progress` column — 1 of 4 issues complete = 0.25,
      // deliberately different from the stale 0.5 on the row above.
      prisma.issue.groupBy
        .mockResolvedValueOnce([{ _count: 4, projectId: 'proj-1' }])
        .mockResolvedValueOnce([{ _count: 1, projectId: 'proj-1' }]);

      const projects = await service.getRoadmapProjects(ORG_ID);
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        id: 'proj-1',
        name: 'Alpha',
        progress: 0.25,
      });
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            roadmapVisible: true,
          }),
        }),
      );
    });

    it('throws RoadmapPasswordError when password is wrong', async () => {
      const hash = await hashRoadmapPassword('right');
      prisma.publicRoadmap.findUnique.mockResolvedValue({
        ...TEST_ROADMAP,
        passwordHash: hash,
      });

      await expect(service.getRoadmapProjects(ORG_ID, 'wrong')).rejects.toThrow(
        RoadmapPasswordError,
      );
    });
  });
});

describe('roadmap unlock token', () => {
  it('validates the token minted for the same slug and password hash', () => {
    const token = roadmapUnlockToken('acme', 'salt:key', 'secret');
    expect(isRoadmapUnlockTokenValid(token, 'acme', 'salt:key', 'secret')).toBe(true);
  });
  it('is rejected once the password hash changes, for another slug, or when absent', () => {
    const token = roadmapUnlockToken('acme', 'salt:key', 'secret');
    expect(isRoadmapUnlockTokenValid(token, 'acme', 'salt:other', 'secret')).toBe(false);
    expect(isRoadmapUnlockTokenValid(token, 'other', 'salt:key', 'secret')).toBe(false);
    expect(isRoadmapUnlockTokenValid(undefined, 'acme', 'salt:key', 'secret')).toBe(false);
    expect(isRoadmapUnlockTokenValid('short', 'acme', 'salt:key', 'secret')).toBe(false);
  });
  it('does not contain the password hash', () => {
    const hash = 'abcd1234:ef015678';
    const token = roadmapUnlockToken('acme', hash, 'secret');
    expect(token).not.toContain(hash);
    expect(token).not.toContain('abcd1234');
    expect(token).not.toContain('ef015678');
  });
  it('expires server-side', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = roadmapUnlockToken('acme', 'salt:key', 'secret', past);
    expect(isRoadmapUnlockTokenValid(expired, 'acme', 'salt:key', 'secret')).toBe(false);
    // Rewriting the expiry without the key must not revalidate it.
    const forged = `${past + 99999}.${expired.split('.')[1]}`;
    expect(isRoadmapUnlockTokenValid(forged, 'acme', 'salt:key', 'secret')).toBe(false);
  });
  it('uses the shared JWT_SECRET accessor by default', () => {
    const token = roadmapUnlockToken('acme', 'salt:key');
    expect(isRoadmapUnlockTokenValid(token, 'acme', 'salt:key')).toBe(true);
    const prev = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'short';
    try {
      expect(() => roadmapUnlockToken('acme', 'salt:key')).toThrow(/at least/);
    } finally {
      process.env.JWT_SECRET = prev;
    }
  });
});

describe('RoadmapService slug validation', () => {
  it('rejects slugs that cannot be a cookie name suffix', async () => {
    const prisma = createMockPrisma();
    const service = new RoadmapService(prisma as never);
    for (const slug of ['has space', 'semi;colon', 'Upper', 'ñandú', '']) {
      await expect(service.upsert(ORG_ID, URL_KEY, { slug })).rejects.toThrow(
        RoadmapSlugInvalidError,
      );
    }
  });
});

describe('RoadmapService.isPasswordAttemptLimited', () => {
  const svc = new RoadmapService(createMockPrisma() as never);
  beforeEach(() => {
    vi.mocked(checkFixedWindow).mockReset();
    vi.mocked(checkFixedWindow).mockResolvedValue({ count: 1, exceeded: false });
    warn.mockClear();
    resetUnknownIpWarning();
  });

  it('uses a per-IP bucket plus the roadmap backstop when the IP is known', async () => {
    await svc.isPasswordAttemptLimited(ROADMAP_ID, '1.2.3.4');
    const keys = vi.mocked(checkFixedWindow).mock.calls.map(c => c[0]);
    expect(keys).toEqual([`rl:roadmap:${ROADMAP_ID}:ip:1.2.3.4`, `rl:roadmap:${ROADMAP_ID}:all`]);
  });

  it('never shares one global per-IP bucket when the IP is unknown', async () => {
    await svc.isPasswordAttemptLimited(ROADMAP_ID, null);
    const keys = vi.mocked(checkFixedWindow).mock.calls.map(c => String(c[0]));
    expect(keys).toEqual([`rl:roadmap:${ROADMAP_ID}:all`]);
    expect(keys.some(k => k.includes('unknown'))).toBe(false);
  });

  it('still honours the roadmap backstop when the IP is unknown, and warns once', async () => {
    vi.mocked(checkFixedWindow).mockResolvedValue({ count: 999, exceeded: true });
    expect(await svc.isPasswordAttemptLimited(ROADMAP_ID, null)).toBe(true);
    await svc.isPasswordAttemptLimited(ROADMAP_ID, null);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
