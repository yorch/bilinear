import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '@/test/prisma-mock';
import {
  DocumentForbiddenError,
  DocumentNotFoundError,
  DocumentService,
} from './document.service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000010';
const USER_2_ID = '00000000-0000-0000-0000-000000000011';
const TEAM_ID = '00000000-0000-0000-0000-000000000100';
const DOC_ID = '00000000-0000-0000-0000-000000000200';

const TEST_DOC = {
  archivedAt: null,
  content: null,
  contentData: null,
  createdAt: new Date('2026-04-17T00:00:00Z'),
  creatorId: USER_ID,
  icon: null,
  id: DOC_ID,
  organizationId: ORG_ID,
  parentId: null,
  projectId: null,
  sortOrder: 0,
  teamId: TEAM_ID,
  title: 'My Doc',
  updatedAt: new Date('2026-04-17T00:00:00Z'),
};

describe('DocumentService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: DocumentService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DocumentService(prisma as never);
  });

  describe('findById', () => {
    it('returns a document when found', async () => {
      prisma.document.findUnique.mockResolvedValue(TEST_DOC);
      const result = await service.findById(DOC_ID);
      expect(result).toEqual(TEST_DOC);
      expect(prisma.document.findUnique).toHaveBeenCalledWith({
        where: { id: DOC_ID },
      });
    });

    it('returns null when not found', async () => {
      prisma.document.findUnique.mockResolvedValue(null);
      const result = await service.findById(DOC_ID);
      expect(result).toBeNull();
    });
  });

  describe('findByOrg', () => {
    it('queries by org with no filters', async () => {
      prisma.document.findMany.mockResolvedValue([TEST_DOC]);
      const result = await service.findByOrg(ORG_ID, {});
      expect(result).toEqual([TEST_DOC]);
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            archivedAt: null,
            organizationId: ORG_ID,
          }),
        }),
      );
    });

    it('applies teamId filter when provided', async () => {
      prisma.document.findMany.mockResolvedValue([TEST_DOC]);
      await service.findByOrg(ORG_ID, { teamId: TEAM_ID });
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ teamId: TEAM_ID }),
        }),
      );
    });

    it('applies projectId filter when provided', async () => {
      const PROJECT_ID = '00000000-0000-0000-0000-000000000300';
      prisma.document.findMany.mockResolvedValue([]);
      await service.findByOrg(ORG_ID, { projectId: PROJECT_ID });
      expect(prisma.document.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: PROJECT_ID }),
        }),
      );
    });
  });

  describe('create', () => {
    it('creates a document with the given input', async () => {
      prisma.document.create.mockResolvedValue(TEST_DOC);
      const result = await service.create(ORG_ID, USER_ID, {
        teamId: TEAM_ID,
        title: 'My Doc',
      });
      expect(result).toEqual(TEST_DOC);
      expect(prisma.document.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          creatorId: USER_ID,
          organizationId: ORG_ID,
          teamId: TEAM_ID,
          title: 'My Doc',
        }),
      });
    });

    it('supports optional id, content, icon, parentId, projectId', async () => {
      const CUSTOM_ID = '00000000-0000-0000-0000-000000000999';
      prisma.document.create.mockResolvedValue({ ...TEST_DOC, id: CUSTOM_ID });
      await service.create(ORG_ID, USER_ID, {
        content: '<p>Hello</p>',
        icon: '📄',
        id: CUSTOM_ID,
        title: 'Rich Doc',
      });
      expect(prisma.document.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          content: '<p>Hello</p>',
          icon: '📄',
          id: CUSTOM_ID,
        }),
      });
    });
  });

  describe('update', () => {
    it('updates only provided fields', async () => {
      const updated = { ...TEST_DOC, title: 'Updated Title' };
      prisma.document.update.mockResolvedValue(updated);
      const result = await service.update(DOC_ID, { title: 'Updated Title' });
      expect(result).toEqual(updated);
      expect(prisma.document.update).toHaveBeenCalledWith({
        data: { title: 'Updated Title' },
        where: { id: DOC_ID },
      });
    });

    it('can clear parentId by setting it to null', async () => {
      prisma.document.update.mockResolvedValue({ ...TEST_DOC, parentId: null });
      await service.update(DOC_ID, { parentId: null });
      expect(prisma.document.update).toHaveBeenCalledWith({
        data: { parentId: null },
        where: { id: DOC_ID },
      });
    });
  });

  describe('archive', () => {
    it('sets archivedAt on the document', async () => {
      const archived = { ...TEST_DOC, archivedAt: new Date() };
      prisma.document.update.mockResolvedValue(archived);
      const result = await service.archive(DOC_ID);
      expect(result.archivedAt).not.toBeNull();
      expect(prisma.document.update).toHaveBeenCalledWith({
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
        where: { id: DOC_ID },
      });
    });
  });

  describe('delete', () => {
    it('deletes the document when called by the creator', async () => {
      prisma.document.findUnique.mockResolvedValue(TEST_DOC);
      prisma.document.delete.mockResolvedValue(TEST_DOC);
      const result = await service.delete(DOC_ID, USER_ID);
      expect(result).toEqual({ id: DOC_ID });
      expect(prisma.document.delete).toHaveBeenCalledWith({
        where: { id: DOC_ID },
      });
    });

    it('throws DocumentNotFoundError when document does not exist', async () => {
      prisma.document.findUnique.mockResolvedValue(null);
      await expect(service.delete(DOC_ID, USER_ID)).rejects.toThrow(
        DocumentNotFoundError,
      );
    });

    it('throws DocumentForbiddenError when called by a non-creator', async () => {
      prisma.document.findUnique.mockResolvedValue(TEST_DOC);
      await expect(service.delete(DOC_ID, USER_2_ID)).rejects.toThrow(
        DocumentForbiddenError,
      );
    });
  });
});
