import { beforeEach, describe, expect, it } from 'vitest';
import { createMockPrisma } from '@/test/prisma-mock';
import {
  DocumentForbiddenError,
  DocumentInvalidParentError,
  DocumentNotFoundError,
  DocumentService,
  DocumentValidationError,
} from './document.service';

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000010';
const USER_2_ID = '00000000-0000-0000-0000-000000000011';
const TEAM_ID = '00000000-0000-0000-0000-000000000100';
const DOC_ID = '00000000-0000-0000-0000-000000000200';
const SCOPE = { hiddenTeamIds: [] as string[], orgId: ORG_ID };
const HIDDEN_TEAM = '00000000-0000-0000-0000-000000000666';

const TEST_DOC = {
  archivedAt: null,
  content: null,
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
    prisma.team.findUnique.mockResolvedValue({ organizationId: ORG_ID });
    prisma.project.findUnique.mockResolvedValue({ organizationId: ORG_ID });
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
      const result = await service.update(DOC_ID, { title: 'Updated Title' }, SCOPE);
      expect(result).toEqual(updated);
      expect(prisma.document.update).toHaveBeenCalledWith({
        data: { title: 'Updated Title' },
        where: { id: DOC_ID },
      });
    });

    it('can clear parentId by setting it to null', async () => {
      prisma.document.update.mockResolvedValue({ ...TEST_DOC, parentId: null });
      await service.update(DOC_ID, { parentId: null }, SCOPE);
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

  describe('unarchive', () => {
    it('clears archivedAt on the document', async () => {
      prisma.document.update.mockResolvedValue(TEST_DOC);
      await service.unarchive(DOC_ID);
      expect(prisma.document.update).toHaveBeenCalledWith({
        data: { archivedAt: null },
        where: { id: DOC_ID },
      });
    });
  });

  describe('findByOrg includeArchived', () => {
    it('omits the archivedAt filter only when includeArchived is set', async () => {
      prisma.document.findMany.mockResolvedValue([]);
      await service.findByOrg(ORG_ID, { includeArchived: true });
      const where = (prisma.document.findMany.mock.calls[0] as [{ where: object }])[0].where;
      expect(where).not.toHaveProperty('archivedAt');
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
      await expect(service.delete(DOC_ID, USER_ID)).rejects.toThrow(DocumentNotFoundError);
    });

    it('throws DocumentForbiddenError when called by a non-creator', async () => {
      prisma.document.findUnique.mockResolvedValue(TEST_DOC);
      await expect(service.delete(DOC_ID, USER_2_ID)).rejects.toThrow(DocumentForbiddenError);
    });
  });

  describe('visibility (private teams)', () => {
    it('findByOrg excludes hidden-team rows but admits workspace-scoped (teamId null) rows', async () => {
      prisma.document.findMany.mockResolvedValue([]);
      await service.findByOrg(ORG_ID, { includeArchived: true }, [HIDDEN_TEAM]);
      const where = (prisma.document.findMany.mock.calls[0] as [{ where: object }])[0].where;
      expect(where).toMatchObject({
        OR: [{ teamId: null }, { teamId: { notIn: [HIDDEN_TEAM] } }],
      });
    });

    it('findVisibleById hides a hidden-team doc and a cross-org doc', async () => {
      prisma.document.findUnique.mockResolvedValue({ ...TEST_DOC, teamId: HIDDEN_TEAM });
      expect(
        await service.findVisibleById(DOC_ID, { hiddenTeamIds: [HIDDEN_TEAM], orgId: ORG_ID }),
      ).toBeNull();
      prisma.document.findUnique.mockResolvedValue({ ...TEST_DOC, organizationId: 'other' });
      expect(await service.findVisibleById(DOC_ID, SCOPE)).toBeNull();
      prisma.document.findUnique.mockResolvedValue(TEST_DOC);
      expect(await service.findVisibleById(DOC_ID, SCOPE)).toEqual(TEST_DOC);
    });

    it('create refuses a hidden team and a team from another org', async () => {
      await expect(
        service.create(ORG_ID, USER_ID, { teamId: HIDDEN_TEAM, title: 'x' }, [HIDDEN_TEAM]),
      ).rejects.toThrow(DocumentNotFoundError);
      prisma.team.findUnique.mockResolvedValue({ organizationId: 'other' });
      await expect(
        service.create(ORG_ID, USER_ID, { teamId: TEAM_ID, title: 'x' }),
      ).rejects.toThrow(DocumentNotFoundError);
      expect(prisma.document.create).not.toHaveBeenCalled();
    });
  });

  describe('parent validation', () => {
    const A = '00000000-0000-0000-0000-00000000000a';
    const B = '00000000-0000-0000-0000-00000000000b';
    const node = (id: string, parentId: string | null, teamId: string | null = TEAM_ID) => ({
      id,
      organizationId: ORG_ID,
      parentId,
      teamId,
    });
    const tree = (rows: ReturnType<typeof node>[]) =>
      prisma.document.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id) ?? null,
      );

    it('rejects a cycle: A under B when B is already a child of A', async () => {
      tree([node(A, null), node(B, A)]);
      await expect(service.update(A, { parentId: B }, SCOPE)).rejects.toThrow(
        DocumentInvalidParentError,
      );
      expect(prisma.document.update).not.toHaveBeenCalled();
    });

    it('rejects self-parenting', async () => {
      tree([node(A, null)]);
      await expect(service.update(A, { parentId: A }, SCOPE)).rejects.toThrow(
        DocumentInvalidParentError,
      );
    });

    it('rejects a missing parent as invalid input, not a database error', async () => {
      tree([node(A, null)]);
      await expect(service.update(A, { parentId: B }, SCOPE)).rejects.toThrow(
        DocumentInvalidParentError,
      );
    });

    it('rejects a parent living in a hidden private team', async () => {
      tree([node(A, null), node(B, null, HIDDEN_TEAM)]);
      await expect(
        service.update(A, { parentId: B }, { hiddenTeamIds: [HIDDEN_TEAM], orgId: ORG_ID }),
      ).rejects.toThrow(DocumentInvalidParentError);
    });

    it('rejects a parent from a different team', async () => {
      tree([node(A, null), node(B, null, 'some-other-team')]);
      await expect(service.update(A, { parentId: B }, SCOPE)).rejects.toThrow(
        DocumentInvalidParentError,
      );
    });

    it('rejects a parent from another org', async () => {
      tree([node(A, null), { ...node(B, null), organizationId: 'other' }]);
      await expect(service.update(A, { parentId: B }, SCOPE)).rejects.toThrow(
        DocumentInvalidParentError,
      );
    });

    it('validates the parent on create too', async () => {
      tree([node(B, null, HIDDEN_TEAM)]);
      await expect(
        service.create(ORG_ID, USER_ID, { parentId: B, teamId: TEAM_ID, title: 'x' }),
      ).rejects.toThrow(DocumentInvalidParentError);
      expect(prisma.document.create).not.toHaveBeenCalled();
    });

    it('accepts a valid re-parent and takes the org-wide parent-write lock first', async () => {
      tree([node(A, null), node(B, null)]);
      prisma.document.update.mockResolvedValue({ ...TEST_DOC, parentId: B });
      await service.update(A, { parentId: B }, SCOPE);
      expect(prisma.document.update).toHaveBeenCalledWith({
        data: { parentId: B },
        where: { id: A },
      });
      const sql = (prisma.$queryRaw.mock.calls[0] as [string[]])[0].join('');
      expect(sql).toContain('pg_advisory_xact_lock');
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.document.update.mock.invocationCallOrder[0] as number,
      );
    });

    it('serialises two opposite re-parents so exactly one wins', async () => {
      // Model pg_advisory_xact_lock: taking it waits for the previous holder's
      // transaction to finish. A transaction that never takes it is not serialised.
      const rows = new Map([
        [A, node(A, null)],
        [B, node(B, null)],
      ]);
      let holder: Promise<void> = Promise.resolve();
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        let finish: () => void = () => undefined;
        const mine = new Promise<void>(r => {
          finish = r;
        });
        const tx = {
          $queryRaw: async () => {
            const prev = holder;
            holder = mine;
            await prev;
          },
          document: prisma.document,
        };
        try {
          return await fn(tx);
        } finally {
          finish();
        }
      });
      prisma.document.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      );
      prisma.document.update.mockImplementation(
        async ({ data, where }: { data: { parentId: string }; where: { id: string } }) => {
          // Yield so an unserialised second tx would interleave its check here.
          await new Promise(r => setTimeout(r, 5));
          const row = rows.get(where.id);
          if (row) {
            row.parentId = data.parentId;
          }
          return row;
        },
      );
      const results = await Promise.allSettled([
        service.update(A, { parentId: B }, SCOPE),
        service.update(B, { parentId: A }, SCOPE),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(rows.get(A)?.parentId === B && rows.get(B)?.parentId === A).toBe(false);
    });
  });

  describe('field validation', () => {
    it('rejects an over-long title as a validation error, not a database error', async () => {
      await expect(
        service.create(ORG_ID, USER_ID, { teamId: TEAM_ID, title: 'x'.repeat(256) }),
      ).rejects.toThrow(DocumentValidationError);
      await expect(service.update(DOC_ID, { title: 'x'.repeat(256) }, SCOPE)).rejects.toThrow(
        DocumentValidationError,
      );
    });
  });
});
