import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '@/test/prisma-mock';
import {
  hashRoadmapPassword,
  RoadmapPasswordError,
  RoadmapService,
  RoadmapSlugConflictError,
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
