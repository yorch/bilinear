import { beforeEach, describe, expect, it } from 'vitest';
import {
  TEST_LABEL,
  TEST_ORG,
  TEST_TEAM,
  TEST_USER,
} from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import { LabelService } from './label.service';

describe('LabelService', () => {
  let prisma: MockPrismaClient;
  let service: LabelService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new LabelService(prisma as never);
  });

  describe('create', () => {
    it('creates a workspace-global label when no teamId provided', async () => {
      prisma.issueLabel.create.mockResolvedValue(TEST_LABEL);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        color: '#ef4444',
        name: 'Bug',
      });

      expect(result).toEqual(TEST_LABEL);
      expect(prisma.issueLabel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          color: '#ef4444',
          creatorId: TEST_USER.id,
          isGroup: false,
          name: 'Bug',
          organizationId: TEST_ORG.id,
          teamId: undefined,
        }),
      });
    });

    it('creates a team-scoped label when teamId provided', async () => {
      const teamLabel = { ...TEST_LABEL, teamId: TEST_TEAM.id };
      prisma.issueLabel.create.mockResolvedValue(teamLabel);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        color: '#ef4444',
        name: 'Bug',
        teamId: TEST_TEAM.id,
      });

      expect(result.teamId).toBe(TEST_TEAM.id);
    });

    it('creates a label group when isGroup is true', async () => {
      const groupLabel = { ...TEST_LABEL, isGroup: true };
      prisma.issueLabel.create.mockResolvedValue(groupLabel);

      await service.create(TEST_ORG.id, TEST_USER.id, {
        color: '#6366f1',
        isGroup: true,
        name: 'Category',
      });

      expect(prisma.issueLabel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isGroup: true }),
      });
    });
  });

  describe('findById', () => {
    it('returns label when found', async () => {
      prisma.issueLabel.findUnique.mockResolvedValue(TEST_LABEL);
      const result = await service.findById(TEST_LABEL.id);
      expect(result).toEqual(TEST_LABEL);
    });

    it('returns null when not found', async () => {
      prisma.issueLabel.findUnique.mockResolvedValue(null);
      const result = await service.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByOrgId', () => {
    it('returns workspace-global labels only when no teamId filter', async () => {
      prisma.issueLabel.findMany.mockResolvedValue([TEST_LABEL]);

      const result = await service.findByOrgId(TEST_ORG.id);

      expect(result).toEqual([TEST_LABEL]);
      expect(prisma.issueLabel.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
        where: {
          archivedAt: null,
          organizationId: TEST_ORG.id,
          teamId: null,
        },
      });
    });

    it('returns global and team labels when teamId provided', async () => {
      prisma.issueLabel.findMany.mockResolvedValue([TEST_LABEL]);

      await service.findByOrgId(TEST_ORG.id, TEST_TEAM.id);

      expect(prisma.issueLabel.findMany).toHaveBeenCalledWith({
        orderBy: { name: 'asc' },
        where: {
          archivedAt: null,
          OR: [{ teamId: null }, { teamId: TEST_TEAM.id }],
          organizationId: TEST_ORG.id,
        },
      });
    });
  });

  describe('update', () => {
    it('updates label fields', async () => {
      const updated = { ...TEST_LABEL, color: '#22c55e', name: 'Feature' };
      prisma.issueLabel.update.mockResolvedValue(updated);

      const result = await service.update(TEST_LABEL.id, {
        color: '#22c55e',
        name: 'Feature',
      });

      expect(result).toEqual(updated);
      expect(prisma.issueLabel.update).toHaveBeenCalledWith({
        data: {
          color: '#22c55e',
          description: undefined,
          name: 'Feature',
          parentId: undefined,
        },
        where: { id: TEST_LABEL.id },
      });
    });
  });

  describe('archive', () => {
    it('sets archivedAt on archive', async () => {
      const archived = { ...TEST_LABEL, archivedAt: new Date() };
      prisma.issueLabel.update.mockResolvedValue(archived);

      const result = await service.archive(TEST_LABEL.id);
      expect(result.archivedAt).not.toBeNull();
      expect(prisma.issueLabel.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_LABEL.id },
      });
    });
  });
});
