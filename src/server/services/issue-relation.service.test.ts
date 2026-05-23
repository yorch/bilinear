import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  IssueRelationAlreadyExistsError,
  IssueRelationCircularError,
  IssueRelationNotFoundError,
  IssueRelationService,
} from './issue-relation.service';

const TEST_RELATION = {
  createdAt: new Date('2026-02-15T00:00:00Z'),
  id: '00000000-0000-0000-0000-000000000700',
  issueId: '00000000-0000-0000-0000-000000000400',
  relatedIssueId: '00000000-0000-0000-0000-000000000401',
  type: 'related',
};

describe('IssueRelationService', () => {
  let prisma: MockPrismaClient;
  let service: IssueRelationService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new IssueRelationService(prisma as never);
  });

  describe('create', () => {
    it('creates relation and its inverse for blocks type', async () => {
      // Inside $transaction: no circular relation found
      prisma.issueRelation.findUnique.mockResolvedValueOnce(null);
      // No duplicate relation
      prisma.issueRelation.findUnique.mockResolvedValueOnce(null);
      // Create the primary relation
      prisma.issueRelation.create.mockResolvedValueOnce({
        ...TEST_RELATION,
        type: 'blocks',
      });
      // Inverse (blocked_by) does not already exist
      prisma.issueRelation.findUnique.mockResolvedValueOnce(null);
      // Create the inverse blocked_by relation
      prisma.issueRelation.create.mockResolvedValueOnce({
        createdAt: new Date('2026-02-15T00:00:00Z'),
        id: '00000000-0000-0000-0000-000000000701',
        issueId: TEST_RELATION.relatedIssueId,
        relatedIssueId: TEST_RELATION.issueId,
        type: 'blocked_by',
      });

      const result = await service.create({
        issueId: TEST_RELATION.issueId,
        relatedIssueId: TEST_RELATION.relatedIssueId,
        type: 'blocks',
      });

      expect(result.relation).toMatchObject({ type: 'blocks' });
      expect(result.canceledIssue).toBeNull();
      expect(prisma.issueRelation.create).toHaveBeenCalledTimes(2);
      expect(prisma.issueRelation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            issueId: TEST_RELATION.issueId,
            relatedIssueId: TEST_RELATION.relatedIssueId,
            type: 'blocks',
          },
        }),
      );
      expect(prisma.issueRelation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            issueId: TEST_RELATION.relatedIssueId,
            relatedIssueId: TEST_RELATION.issueId,
            type: 'blocked_by',
          },
        }),
      );
    });

    it('throws IssueRelationAlreadyExistsError when relation already exists', async () => {
      // No circular check hit (type is 'related')
      // Duplicate check finds existing
      prisma.issueRelation.findUnique.mockResolvedValueOnce(TEST_RELATION);

      await expect(
        service.create({
          issueId: TEST_RELATION.issueId,
          relatedIssueId: TEST_RELATION.relatedIssueId,
          type: 'related',
        }),
      ).rejects.toThrow(IssueRelationAlreadyExistsError);
    });

    it('throws IssueRelationCircularError when A blocks B and B already blocks A', async () => {
      // Circular check finds that relatedIssue already blocks issueId
      prisma.issueRelation.findUnique.mockResolvedValueOnce({
        ...TEST_RELATION,
        issueId: TEST_RELATION.relatedIssueId,
        relatedIssueId: TEST_RELATION.issueId,
        type: 'blocks',
      });

      await expect(
        service.create({
          issueId: TEST_RELATION.issueId,
          relatedIssueId: TEST_RELATION.relatedIssueId,
          type: 'blocks',
        }),
      ).rejects.toThrow(IssueRelationCircularError);
    });

    it('throws IssueRelationCircularError when issueId === relatedIssueId', async () => {
      await expect(
        service.create({
          issueId: TEST_RELATION.issueId,
          relatedIssueId: TEST_RELATION.issueId,
          type: 'related',
        }),
      ).rejects.toThrow(IssueRelationCircularError);
    });
  });

  describe('delete', () => {
    it('deletes the relation', async () => {
      prisma.issueRelation.findUnique.mockResolvedValue(TEST_RELATION);
      prisma.issueRelation.delete.mockResolvedValue(TEST_RELATION);

      await service.delete(TEST_RELATION.id);

      expect(prisma.issueRelation.delete).toHaveBeenCalledWith({
        where: { id: TEST_RELATION.id },
      });
    });

    it('also deletes the inverse blocked_by relation when deleting a blocks relation', async () => {
      const blocksRelation = { ...TEST_RELATION, type: 'blocks' };
      prisma.issueRelation.findUnique.mockResolvedValue(blocksRelation);
      prisma.issueRelation.deleteMany.mockResolvedValue({ count: 1 });
      prisma.issueRelation.delete.mockResolvedValue(blocksRelation);

      await service.delete(blocksRelation.id);

      expect(prisma.issueRelation.deleteMany).toHaveBeenCalledWith({
        where: {
          issueId: blocksRelation.relatedIssueId,
          relatedIssueId: blocksRelation.issueId,
          type: 'blocked_by',
        },
      });
      expect(prisma.issueRelation.delete).toHaveBeenCalledWith({
        where: { id: blocksRelation.id },
      });
    });

    it('also deletes the inverse duplicate relation when deleting a duplicate relation', async () => {
      const dupRelation = { ...TEST_RELATION, type: 'duplicate' };
      prisma.issueRelation.findUnique.mockResolvedValue(dupRelation);
      prisma.issueRelation.deleteMany.mockResolvedValue({ count: 1 });
      prisma.issueRelation.delete.mockResolvedValue(dupRelation);

      await service.delete(dupRelation.id);

      expect(prisma.issueRelation.deleteMany).toHaveBeenCalledWith({
        where: {
          issueId: dupRelation.relatedIssueId,
          relatedIssueId: dupRelation.issueId,
          type: 'duplicate',
        },
      });
    });

    it('does NOT call deleteMany for related type (no directed inverse)', async () => {
      prisma.issueRelation.findUnique.mockResolvedValue(TEST_RELATION);
      prisma.issueRelation.delete.mockResolvedValue(TEST_RELATION);

      await service.delete(TEST_RELATION.id);

      expect(prisma.issueRelation.deleteMany).not.toHaveBeenCalled();
    });

    it('throws IssueRelationNotFoundError when not found', async () => {
      prisma.issueRelation.findUnique.mockResolvedValue(null);

      await expect(service.delete(TEST_RELATION.id)).rejects.toThrow(IssueRelationNotFoundError);
    });
  });

  describe('findByIssueId', () => {
    it('returns relations where issueId OR relatedIssueId matches', async () => {
      const inverseRelation = {
        ...TEST_RELATION,
        id: '00000000-0000-0000-0000-000000000701',
        issueId: TEST_RELATION.relatedIssueId,
        relatedIssueId: TEST_RELATION.issueId,
      };
      prisma.issueRelation.findMany.mockResolvedValue([TEST_RELATION, inverseRelation]);

      const result = await service.findByIssueId(TEST_RELATION.issueId);

      expect(result).toEqual([TEST_RELATION, inverseRelation]);
      expect(prisma.issueRelation.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
        where: {
          OR: [{ issueId: TEST_RELATION.issueId }, { relatedIssueId: TEST_RELATION.issueId }],
        },
      });
    });
  });
});
