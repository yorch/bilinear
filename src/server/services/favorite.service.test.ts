import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_ORG, TEST_USER } from '../../test/fixtures';
import { createMockPrisma, type MockPrismaClient } from '../../test/prisma-mock';
import {
  FavoriteCrossOrgConflictError,
  FavoriteEntityNotInOrgError,
  FavoriteInvalidEntityTypeError,
  FavoriteNotFoundError,
  FavoriteReorderTooLargeError,
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
    it('creates a new favorite after verifying the entity belongs to the org', async () => {
      prisma.issue.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.favorite.findFirst.mockResolvedValue(null);
      prisma.favorite.create.mockResolvedValue(TEST_FAVORITE);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Issue',
      });

      expect(result).toEqual(TEST_FAVORITE);
      expect(prisma.issue.findUnique).toHaveBeenCalledWith({
        select: { organizationId: true },
        where: { id: TEST_FAVORITE.entityId },
      });
      // Scoped by organizationId — not just the (userId, entityType,
      // entityId) natural key — so a same-entityId row belonging to a
      // different org is never selected for this org's lookup.
      expect(prisma.favorite.findFirst).toHaveBeenCalledWith({
        where: {
          entityId: TEST_FAVORITE.entityId,
          entityType: 'Issue',
          organizationId: TEST_ORG.id,
          userId: TEST_USER.id,
        },
      });
      expect(prisma.favorite.create).toHaveBeenCalledWith({
        data: {
          entityId: TEST_FAVORITE.entityId,
          entityType: 'Issue',
          organizationId: TEST_ORG.id,
          sortOrder: 0,
          userId: TEST_USER.id,
        },
      });
    });

    it('is idempotent: re-favoriting without an explicit sortOrder returns the existing row untouched', async () => {
      prisma.project.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.favorite.findFirst.mockResolvedValue(TEST_FAVORITE);

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Project',
      });

      expect(result).toEqual(TEST_FAVORITE);
      expect(prisma.favorite.update).not.toHaveBeenCalled();
      expect(prisma.favorite.create).not.toHaveBeenCalled();
    });

    it('updates sortOrder on the existing row when explicitly provided', async () => {
      prisma.project.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.favorite.findFirst.mockResolvedValue(TEST_FAVORITE);
      prisma.favorite.update.mockResolvedValue({ ...TEST_FAVORITE, sortOrder: 5 });

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Project',
        sortOrder: 5,
      });

      expect(result.sortOrder).toBe(5);
      expect(prisma.favorite.update).toHaveBeenCalledWith({
        data: { sortOrder: 5 },
        where: { id: TEST_FAVORITE.id },
      });
      expect(prisma.favorite.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown entityType without touching the db', async () => {
      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          entityId: TEST_FAVORITE.entityId,
          // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
          entityType: 'Nonsense' as any,
        }),
      ).rejects.toThrow(FavoriteInvalidEntityTypeError);
      expect(prisma.favorite.findFirst).not.toHaveBeenCalled();
      expect(prisma.favorite.create).not.toHaveBeenCalled();
    });

    it('rejects when the entity does not belong to the caller org', async () => {
      prisma.issue.findUnique.mockResolvedValue({ organizationId: 'other-org' });

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          entityId: TEST_FAVORITE.entityId,
          entityType: 'Issue',
        }),
      ).rejects.toThrow(FavoriteEntityNotInOrgError);
      expect(prisma.favorite.findFirst).not.toHaveBeenCalled();
      expect(prisma.favorite.create).not.toHaveBeenCalled();
    });

    it('surfaces a conflict instead of silently mutating another org row on a physical unique-key collision', async () => {
      // Entity genuinely belongs to this org, and this org has no favorite
      // row for it yet (findFirst, scoped by organizationId, returns
      // null) — but the DB's (userId, entityType, entityId) unique key
      // isn't org-scoped, so a row for the SAME entityId already exists
      // under a different org and the raw INSERT collides.
      prisma.issue.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.favorite.findFirst.mockResolvedValue(null);
      prisma.favorite.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(
        service.create(TEST_ORG.id, TEST_USER.id, {
          entityId: TEST_FAVORITE.entityId,
          entityType: 'Issue',
        }),
      ).rejects.toThrow(FavoriteCrossOrgConflictError);
      // Must NOT fall back to updating whatever row the natural key
      // matched — that would be the exact cross-org mutation this fixes.
      expect(prisma.favorite.update).not.toHaveBeenCalled();
    });

    it('treats a concurrent same-org double-favorite race as idempotent success', async () => {
      // A double-click / optimistic-retry can lose a race: our initial
      // org-scoped findFirst sees nothing, but by the time our create()
      // hits the DB, a concurrent request for the SAME org has already
      // inserted the row and committed, so our create() throws P2002.
      // That must resolve as idempotent success (like the old upsert did),
      // not a FavoriteCrossOrgConflictError.
      prisma.issue.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.favorite.findFirst
        .mockResolvedValueOnce(null) // initial org-scoped check
        .mockResolvedValueOnce(TEST_FAVORITE); // re-read after P2002: winner's row, same org
      prisma.favorite.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Issue',
      });

      expect(result).toEqual(TEST_FAVORITE);
      expect(prisma.favorite.update).not.toHaveBeenCalled();
    });

    it('updates sortOrder on the winner row when the race includes an explicit sortOrder', async () => {
      prisma.issue.findUnique.mockResolvedValue({ organizationId: TEST_ORG.id });
      prisma.favorite.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(TEST_FAVORITE);
      prisma.favorite.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      prisma.favorite.update.mockResolvedValue({ ...TEST_FAVORITE, sortOrder: 7 });

      const result = await service.create(TEST_ORG.id, TEST_USER.id, {
        entityId: TEST_FAVORITE.entityId,
        entityType: 'Issue',
        sortOrder: 7,
      });

      expect(result.sortOrder).toBe(7);
      expect(prisma.favorite.update).toHaveBeenCalledWith({
        data: { sortOrder: 7 },
        where: { id: TEST_FAVORITE.id },
      });
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

    it('rejects an oversized reorder batch without starting a transaction', async () => {
      const entries = Array.from({ length: 201 }, (_, i) => ({
        id: `favorite-${i}`,
        sortOrder: i,
      }));

      await expect(service.reorder(TEST_ORG.id, TEST_USER.id, entries)).rejects.toThrow(
        FavoriteReorderTooLargeError,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
