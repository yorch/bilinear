import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '@/test/prisma-mock';
import { CustomViewService } from './custom-view.service';

const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000010';
const TEST_USER_2_ID = '00000000-0000-0000-0000-000000000011';
const TEST_TEAM_ID = '00000000-0000-0000-0000-000000000100';

const TEST_VIEW = {
  archivedAt: null,
  color: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
  creatorId: TEST_USER_ID,
  description: null,
  filters: {},
  groupBy: null,
  icon: null,
  id: '00000000-0000-0000-0000-000000000700',
  layout: 'list',
  name: 'My View',
  organizationId: TEST_ORG_ID,
  shared: false,
  sort: [],
  sortOrder: 0,
  teamId: TEST_TEAM_ID,
  updatedAt: new Date('2026-03-01T00:00:00Z'),
};

describe('CustomViewService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: CustomViewService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CustomViewService(prisma as never);
  });

  describe('create', () => {
    it('creates a custom view with default values', async () => {
      prisma.customView.create.mockResolvedValue(TEST_VIEW);

      const result = await service.create(TEST_ORG_ID, TEST_USER_ID, {
        name: 'My View',
        teamId: TEST_TEAM_ID,
      });

      expect(result).toEqual(TEST_VIEW);
      expect(prisma.customView.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          creatorId: TEST_USER_ID,
          layout: 'list',
          name: 'My View',
          organizationId: TEST_ORG_ID,
          shared: false,
          teamId: TEST_TEAM_ID,
        }),
      });
    });

    it('creates a shared view with custom filters', async () => {
      const filters = { composition: 'and', conditions: [] };
      prisma.customView.create.mockResolvedValue({
        ...TEST_VIEW,
        filters,
        shared: true,
      });

      await service.create(TEST_ORG_ID, TEST_USER_ID, {
        filters,
        name: 'Shared View',
        shared: true,
        teamId: TEST_TEAM_ID,
      });

      expect(prisma.customView.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          filters,
          shared: true,
        }),
      });
    });
  });

  describe('findById', () => {
    it('returns the view when found', async () => {
      prisma.customView.findUnique.mockResolvedValue(TEST_VIEW);

      const result = await service.findById(TEST_VIEW.id);

      expect(result).toEqual(TEST_VIEW);
    });

    it('returns null when not found', async () => {
      prisma.customView.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByOrgId', () => {
    it('returns own and shared views', async () => {
      const sharedView = {
        ...TEST_VIEW,
        creatorId: TEST_USER_2_ID,
        shared: true,
      };
      prisma.customView.findMany.mockResolvedValue([TEST_VIEW, sharedView]);

      const result = await service.findByOrgId(TEST_ORG_ID, TEST_USER_ID);

      expect(result).toHaveLength(2);
      expect(prisma.customView.findMany).toHaveBeenCalledWith({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        where: {
          archivedAt: null,
          OR: [{ creatorId: TEST_USER_ID }, { shared: true }],
          organizationId: TEST_ORG_ID,
        },
      });
    });

    it('filters by teamId when provided', async () => {
      prisma.customView.findMany.mockResolvedValue([TEST_VIEW]);

      await service.findByOrgId(TEST_ORG_ID, TEST_USER_ID, TEST_TEAM_ID);

      expect(prisma.customView.findMany).toHaveBeenCalledWith({
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        where: expect.objectContaining({
          teamId: TEST_TEAM_ID,
        }),
      });
    });
  });

  describe('update', () => {
    it('updates specified fields only', async () => {
      const updated = { ...TEST_VIEW, name: 'Renamed' };
      prisma.customView.update.mockResolvedValue(updated);

      const result = await service.update(TEST_VIEW.id, { name: 'Renamed' });

      expect(result.name).toBe('Renamed');
      expect(prisma.customView.update).toHaveBeenCalledWith({
        data: { name: 'Renamed' },
        where: { id: TEST_VIEW.id },
      });
    });

    it('updates filters and sort', async () => {
      const newFilters = {
        composition: 'or',
        conditions: [{ field: 'priority', operator: 'eq', value: 1 }],
      };
      const newSort = [{ direction: 'asc', field: 'priority' }];
      prisma.customView.update.mockResolvedValue({
        ...TEST_VIEW,
        filters: newFilters,
        sort: newSort,
      });

      await service.update(TEST_VIEW.id, {
        filters: newFilters,
        sort: newSort,
      });

      expect(prisma.customView.update).toHaveBeenCalledWith({
        data: { filters: newFilters, sort: newSort },
        where: { id: TEST_VIEW.id },
      });
    });

    it('does not include undefined fields', async () => {
      prisma.customView.update.mockResolvedValue(TEST_VIEW);

      await service.update(TEST_VIEW.id, { name: 'New Name' });

      const call = prisma.customView.update.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('filters');
      expect(call.data).not.toHaveProperty('shared');
    });
  });

  describe('archive', () => {
    it('sets archivedAt', async () => {
      const archived = { ...TEST_VIEW, archivedAt: new Date() };
      prisma.customView.update.mockResolvedValue(archived);

      const result = await service.archive(TEST_VIEW.id);

      expect(result.archivedAt).not.toBeNull();
      expect(prisma.customView.update).toHaveBeenCalledWith({
        data: { archivedAt: expect.any(Date) },
        where: { id: TEST_VIEW.id },
      });
    });
  });

  describe('delete', () => {
    it('hard-deletes the view', async () => {
      prisma.customView.delete.mockResolvedValue(TEST_VIEW);

      await service.delete(TEST_VIEW.id);

      expect(prisma.customView.delete).toHaveBeenCalledWith({
        where: { id: TEST_VIEW.id },
      });
    });
  });
});
