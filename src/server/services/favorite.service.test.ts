import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  FavoriteInvalidEntityTypeError,
  FavoriteNotFoundError,
  FavoriteService,
} from './favorite.service';

const TEST_FAVORITE = {
  createdAt: new Date('2026-03-01T00:00:00Z'),
  entityId: '00000000-0000-0000-0000-000000000400',
  entityType: 'Issue',
  id: '00000000-0000-0000-0000-000000000600',
  organizationId: TEST_ORG.id,
  sortOrder: 0,
  updatedAt: new Date('2026-03-01T00:00:00Z'),
  userId: TEST_USER.id,
};

describe('FavoriteService', () => {
  let prisma: MockPrismaClient;
  let service: FavoriteService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new FavoriteService(prisma as never);
  });

  describe('create', () => {
    it('upserts a favorite by the natural key', async () => {
      prisma.favorite.upsert.mockResolvedValue(TEST_FAVORITE);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Issue',
      });

      expect(result).toEqual(TEST_FAVORITE);
      expect(prisma.favorite.upsert).toHaveBeenCalledWith({
        create: {
          entityId: TEST_FAVORITE.entityId,
          entityType: 'Issue',
          organizationId: TEST_ORG.id,
          sortOrder: 0,
          userId: TEST_USER.id,
        },
        update: {},
        where: {
          userId_entityType_entityId: {
            entityId: TEST_FAVORITE.entityId,
            entityType: 'Issue',
            userId: TEST_USER.id,
          },
        },
      });
    });

    it('updates sortOrder when explicitly provided', async () => {
      prisma.favorite.upsert.mockResolvedValue({ ...TEST_FAVORITE, sortOrder: 5 });

      await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Project',
        sortOrder: 5,
      });

      expect(prisma.favorite.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ sortOrder: 5 }),
          update: { sortOrder: 5 },
        }),
      );
    });

    it('rejects an unknown entityType without touching the db', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          entityId: TEST_FAVORITE.entityId,
          // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
          entityType: 'Nonsense' as any,
        }),
      ).rejects.toThrow(FavoriteInvalidEntityTypeError);
      expect(prisma.favorite.upsert).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes a favorite owned by the caller', async () => {
      prisma.favorite.findFirst.mockResolvedValue(TEST_FAVORITE);
      prisma.favorite.delete.mockResolvedValue(TEST_FAVORITE);

      const result = await service.delete(TEST_ORG.id, TEST_USER.id, TEST_FAVORITE.id);

      expect(result).toEqual(TEST_FAVORITE);
      expect(prisma.favorite.findFirst).toHaveBeenCalledWith({
        where: { id: TEST_FAVORITE.id, organizationId: TEST_ORG.id, userId: TEST_USER.id },
      });
      expect(prisma.favorite.delete).toHaveBeenCalledWith({ where: { id: TEST_FAVORITE.id } });
    });

    it('throws when the favorite is not found / not owned', async () => {
      prisma.favorite.findFirst.mockResolvedValue(null);

      await expect(service.delete(TEST_ORG.id, TEST_USER.id, TEST_FAVORITE.id)).rejects.toThrow(
        FavoriteNotFoundError,
      );
      expect(prisma.favorite.delete).not.toHaveBeenCalled();
    });
  });

  describe('findByUser', () => {
    it('returns favorites ordered for sidebar render', async () => {
      prisma.favorite.findMany.mockResolvedValue([TEST_FAVORITE]);

      const result = await service.findByUser(TEST_ORG.id, TEST_USER.id);

      expect(result).toEqual([TEST_FAVORITE]);
      expect(prisma.favorite.findMany).toHaveBeenCalledWith({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        where: { organizationId: TEST_ORG.id, userId: TEST_USER.id },
      });
    });
  });

  describe('reorder', () => {
    it('returns early for an empty entry list', async () => {
      const result = await service.reorder(TEST_ORG.id, TEST_USER.id, []);

      expect(result).toEqual([]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('updates every row and returns the new ordering', async () => {
      const second = { ...TEST_FAVORITE, id: '00000000-0000-0000-0000-000000000601', sortOrder: 1 };
      const tx = {
        favorite: {
          findMany: vi
            .fn()
            // claim verification
            .mockResolvedValueOnce([{ id: TEST_FAVORITE.id }, { id: second.id }])
            // final ordered read
            .mockResolvedValueOnce([
              { ...TEST_FAVORITE, sortOrder: 0 },
              { ...second, sortOrder: 1 },
            ]),
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

      const result = await service.reorder(TEST_ORG.id, TEST_USER.id, [
        { id: TEST_FAVORITE.id, sortOrder: 0 },
        { id: second.id, sortOrder: 1 },
      ]);

      expect(tx.favorite.update).toHaveBeenCalledTimes(2);
      expect(tx.favorite.update).toHaveBeenNthCalledWith(1, {
        data: { sortOrder: 0 },
        where: { id: TEST_FAVORITE.id },
      });
      expect(result).toHaveLength(2);
      expect(result[1].sortOrder).toBe(1);
    });

    it('rejects when an entry belongs to another user', async () => {
      const tx = {
        favorite: {
          // claim returns fewer rows than requested → ownership mismatch
          findMany: vi.fn().mockResolvedValueOnce([{ id: TEST_FAVORITE.id }]),
          update: vi.fn(),
        },
      };
      prisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));

      await expect(
        service.reorder(TEST_ORG.id, TEST_USER.id, [
          { id: TEST_FAVORITE.id, sortOrder: 0 },
          { id: '00000000-0000-0000-0000-0000000006ff', sortOrder: 1 },
        ]),
      ).rejects.toThrow(FavoriteNotFoundError);
      expect(tx.favorite.update).not.toHaveBeenCalled();
    });
  });
});
