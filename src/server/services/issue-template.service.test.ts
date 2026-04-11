import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_TEAM, TEST_USER } from '../../test/fixtures';
import {
  createMockPrisma,
  type MockPrismaClient,
} from '../../test/prisma-mock';
import { IssueTemplateService } from './issue-template.service';

const TEST_TEMPLATE = {
  archivedAt: null,
  createdAt: new Date('2026-02-15T00:00:00Z'),
  creatorId: TEST_USER.id,
  description: null,
  id: '00000000-0000-0000-0000-000000000800',
  isDefault: false,
  name: 'Bug Report',
  teamId: TEST_TEAM.id,
  templateData: { labelIds: [], priority: 2 },
  updatedAt: new Date('2026-02-15T00:00:00Z'),
};

describe('IssueTemplateService', () => {
  let prisma: MockPrismaClient;
  let service: IssueTemplateService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new IssueTemplateService(prisma as never);
  });

  describe('create', () => {
    it('creates template without isDefault', async () => {
      prisma.issueTemplate.create.mockResolvedValue(TEST_TEMPLATE);

      const result = await service.create(
        { name: 'Bug Report', teamId: TEST_TEAM.id },
        TEST_USER.id,
      );

      expect(result).toEqual(TEST_TEMPLATE);
      expect(prisma.issueTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          creatorId: TEST_USER.id,
          isDefault: false,
          name: 'Bug Report',
          teamId: TEST_TEAM.id,
        }),
      });
      expect(prisma.issueTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('when isDefault=true, calls updateMany to unset other defaults first', async () => {
      const defaultTemplate = { ...TEST_TEMPLATE, isDefault: true };
      prisma.issueTemplate.updateMany.mockResolvedValue({ count: 1 });
      prisma.issueTemplate.create.mockResolvedValue(defaultTemplate);

      const result = await service.create(
        { isDefault: true, name: 'Bug Report', teamId: TEST_TEAM.id },
        TEST_USER.id,
      );

      expect(result).toEqual(defaultTemplate);
      expect(prisma.issueTemplate.updateMany).toHaveBeenCalledWith({
        data: { isDefault: false },
        where: { archivedAt: null, isDefault: true, teamId: TEST_TEAM.id },
      });
      expect(prisma.issueTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isDefault: true,
          name: 'Bug Report',
          teamId: TEST_TEAM.id,
        }),
      });
    });
  });

  describe('update', () => {
    it('updates name and description', async () => {
      const updated = {
        ...TEST_TEMPLATE,
        description: 'A template for bugs',
        name: 'Bug Report Updated',
      };
      prisma.issueTemplate.findUnique.mockResolvedValue(TEST_TEMPLATE);
      prisma.issueTemplate.update.mockResolvedValue(updated);

      const result = await service.update(TEST_TEMPLATE.id, {
        description: 'A template for bugs',
        name: 'Bug Report Updated',
      });

      expect(result).toEqual(updated);
      expect(prisma.issueTemplate.update).toHaveBeenCalledWith({
        data: {
          description: 'A template for bugs',
          name: 'Bug Report Updated',
        },
        where: { id: TEST_TEMPLATE.id },
      });
    });
  });

  describe('archive', () => {
    it('sets archivedAt', async () => {
      const now = new Date();
      prisma.issueTemplate.findUnique.mockResolvedValue(TEST_TEMPLATE);
      prisma.issueTemplate.update.mockResolvedValue({
        ...TEST_TEMPLATE,
        archivedAt: now,
      });

      const result = await service.archive(TEST_TEMPLATE.id);

      expect(result.archivedAt).not.toBeNull();
      expect(prisma.issueTemplate.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_TEMPLATE.id },
      });
    });
  });

  describe('delete', () => {
    it('hard deletes', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValue(TEST_TEMPLATE);
      prisma.issueTemplate.delete.mockResolvedValue(TEST_TEMPLATE);

      await service.delete(TEST_TEMPLATE.id);

      expect(prisma.issueTemplate.delete).toHaveBeenCalledWith({
        where: { id: TEST_TEMPLATE.id },
      });
    });
  });

  describe('findByTeamId', () => {
    it('returns templates for team ordered by isDefault desc, name asc', async () => {
      prisma.issueTemplate.findMany.mockResolvedValue([TEST_TEMPLATE]);

      const result = await service.findByTeamId(TEST_TEAM.id);

      expect(result).toEqual([TEST_TEMPLATE]);
      expect(prisma.issueTemplate.findMany).toHaveBeenCalledWith({
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        where: { archivedAt: null, teamId: TEST_TEAM.id },
      });
    });
  });
});
