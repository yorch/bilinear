import { describe, expect, it, vi } from 'vitest';
import { SearchService } from './search.service';
import { TEST_ISSUE, TEST_ORG } from '../../test/fixtures';
import { createMockPrisma } from '../../test/prisma-mock';

describe('SearchService', () => {
  describe('searchIssues', () => {
    it('returns empty array for blank query', async () => {
      const prisma = createMockPrisma();
      const service = new SearchService(prisma as never);

      const result = await service.searchIssues(TEST_ORG.id, '   ');
      expect(result).toEqual([]);
      expect(prisma.issue.findFirst).not.toHaveBeenCalled();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('performs identifier lookup for ENG-123 pattern', async () => {
      const prisma = createMockPrisma();
      prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);
      const service = new SearchService(prisma as never);

      const result = await service.searchIssues(TEST_ORG.id, 'ENG-1');

      expect(prisma.issue.findFirst).toHaveBeenCalledWith({
        where: {
          identifier: 'ENG-1',
          organizationId: TEST_ORG.id,
          archivedAt: null,
          trashed: false,
        },
      });
      expect(result).toEqual([TEST_ISSUE]);
    });

    it('identifier lookup is case-insensitive — lowercased input is uppercased', async () => {
      const prisma = createMockPrisma();
      prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);
      const service = new SearchService(prisma as never);

      await service.searchIssues(TEST_ORG.id, 'eng-1');

      expect(prisma.issue.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ identifier: 'ENG-1' }) }),
      );
    });

    it('returns empty array when identifier not found', async () => {
      const prisma = createMockPrisma();
      prisma.issue.findFirst.mockResolvedValue(null);
      const service = new SearchService(prisma as never);

      const result = await service.searchIssues(TEST_ORG.id, 'ENG-999');
      expect(result).toEqual([]);
    });

    it('identifier lookup includes archived when includeArchived=true', async () => {
      const prisma = createMockPrisma();
      prisma.issue.findFirst.mockResolvedValue(TEST_ISSUE);
      const service = new SearchService(prisma as never);

      await service.searchIssues(TEST_ORG.id, 'ENG-1', 20, true);

      expect(prisma.issue.findFirst).toHaveBeenCalledWith({
        where: {
          identifier: 'ENG-1',
          organizationId: TEST_ORG.id,
          // No archivedAt / trashed filter
        },
      });
    });

    it('uses $queryRaw for free-text queries', async () => {
      const prisma = createMockPrisma();
      prisma.$queryRaw.mockResolvedValue([{ id: TEST_ISSUE.id }]);
      prisma.issue.findMany.mockResolvedValue([TEST_ISSUE]);
      const service = new SearchService(prisma as never);

      const result = await service.searchIssues(TEST_ORG.id, 'broken login');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.issue.findMany).toHaveBeenCalledWith({
        where: { id: { in: [TEST_ISSUE.id] } },
      });
      expect(result).toEqual([TEST_ISSUE]);
    });

    it('returns empty array when FTS finds no rows', async () => {
      const prisma = createMockPrisma();
      prisma.$queryRaw.mockResolvedValue([]);
      const service = new SearchService(prisma as never);

      const result = await service.searchIssues(TEST_ORG.id, 'xyzzy not found');

      expect(result).toEqual([]);
      // findMany should NOT be called when FTS returns nothing
      expect(prisma.issue.findMany).not.toHaveBeenCalled();
    });

    it('preserves FTS rank order from the raw query', async () => {
      const issue1 = { ...TEST_ISSUE, id: 'id-1', title: 'First result' };
      const issue2 = { ...TEST_ISSUE, id: 'id-2', title: 'Second result' };
      // Raw query returns id-1 first (higher rank)
      const prisma = createMockPrisma();
      prisma.$queryRaw.mockResolvedValue([{ id: 'id-1' }, { id: 'id-2' }]);
      // findMany might return them in a different order
      prisma.issue.findMany.mockResolvedValue([issue2, issue1]);
      const service = new SearchService(prisma as never);

      const result = await service.searchIssues(TEST_ORG.id, 'result');

      expect(result[0].id).toBe('id-1');
      expect(result[1].id).toBe('id-2');
    });
  });
});
