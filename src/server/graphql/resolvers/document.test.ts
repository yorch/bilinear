import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ORG } from '../../../test/fixtures';
import { DocumentService } from '../../services/document.service';
import { documentResolvers } from './document';

const DOC = { archivedAt: null, id: 'doc-1', organizationId: TEST_ORG.id };

describe('documentResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
    // The shared mock context predates documents; wire the real service over mock Prisma.
    (ctx.services as Record<string, unknown>).document = new DocumentService(ctx.prisma as never);
    // No private teams by default; individual tests make one hidden.
    ctx.prisma.team.findMany.mockResolvedValue([]);
    ctx.prisma.teamMemberRole.findMany.mockResolvedValue([]);
  });

  /** One private team the caller is not a member of. */
  const hideTeam = (teamId: string) =>
    ctx.prisma.team.findMany.mockResolvedValue([
      { id: teamId, memberships: [], organizationId: TEST_ORG.id },
    ]);
  const PRIVATE_TEAM = '00000000-0000-0000-0000-0000000000f1';
  const HIDDEN_DOC = { ...DOC, archivedAt: new Date(), teamId: PRIVATE_TEAM };
  const call = (name: keyof typeof documentResolvers.Mutation, args: object) =>
    (documentResolvers.Mutation[name] as (...a: unknown[]) => Promise<unknown>)(
      null,
      args,
      ctx as never,
    );

  describe('private-team visibility', () => {
    beforeEach(() => {
      hideTeam(PRIVATE_TEAM);
      ctx.prisma.document.findUnique.mockResolvedValue(HIDDEN_DOC);
    });

    it.each([
      ['documentUnarchive', { id: DOC.id }],
      ['documentArchive', { id: DOC.id }],
      ['documentUpdate', { id: DOC.id, input: { title: 'x' } }],
      ['documentDelete', { id: DOC.id }],
    ] as const)(
      '%s on a hidden-team document is NOT_FOUND and writes nothing',
      async (name, args) => {
        await expect(call(name, args)).rejects.toMatchObject({
          extensions: { code: 'NOT_FOUND' },
        });
        expect(ctx.prisma.document.update).not.toHaveBeenCalled();
        expect(ctx.prisma.document.delete).not.toHaveBeenCalled();
      },
    );

    it('Query.document returns null for a hidden-team document', async () => {
      expect(await documentResolvers.Query.document(null, { id: DOC.id }, ctx as never)).toBeNull();
    });

    it('Query.documents passes the hidden teams to the query, even with includeArchived', async () => {
      ctx.prisma.document.findMany.mockResolvedValue([]);
      await documentResolvers.Query.documents(null, { includeArchived: true }, ctx as never);
      const where = (ctx.prisma.document.findMany.mock.calls[0] as [{ where: object }])[0].where;
      expect(where).toMatchObject({
        OR: [{ teamId: null }, { teamId: { notIn: [PRIVATE_TEAM] } }],
      });
    });

    it('documentCreate into a hidden team is NOT_FOUND', async () => {
      await expect(
        call('documentCreate', { input: { teamId: PRIVATE_TEAM, title: 'x' } }),
      ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    });
  });

  describe('team-document write gate (guests read-only, non-members out)', () => {
    const TEAM = '00000000-0000-0000-0000-0000000000e1';
    const TEAM_DOC = { ...DOC, teamId: TEAM };
    const WRITES = [
      ['documentCreate', { input: { teamId: TEAM, title: 'x' } }],
      ['documentUpdate', { id: DOC.id, input: { title: 'x' } }],
      ['documentArchive', { id: DOC.id }],
      ['documentUnarchive', { id: DOC.id }],
      ['documentDelete', { id: DOC.id }],
    ] as const;

    function asRole(role: 'guest' | 'member' | null) {
      ctx.prisma.document.findUnique.mockResolvedValue(TEAM_DOC);
      ctx.prisma.team.findFirst.mockResolvedValue({ id: TEAM, organizationId: TEST_ORG.id });
      ctx.prisma.team.findUnique.mockResolvedValue({ id: TEAM, organizationId: TEST_ORG.id });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(
        role === null ? null : { team: { organizationId: TEST_ORG.id } },
      );
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue(role ? { role } : null);
    }

    it.each(WRITES)(
      '%s is FORBIDDEN for a guest of the team and writes nothing',
      async (name, args) => {
        asRole('guest');
        await expect(call(name, args)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
        expect(ctx.prisma.document.create).not.toHaveBeenCalled();
        expect(ctx.prisma.document.update).not.toHaveBeenCalled();
        expect(ctx.prisma.document.delete).not.toHaveBeenCalled();
      },
    );

    it.each(WRITES)('%s is FORBIDDEN for an org member outside the team', async (name, args) => {
      asRole(null);
      await expect(call(name, args)).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN' } });
    });

    it('a team member can still archive a team document', async () => {
      asRole('member');
      ctx.prisma.document.update.mockResolvedValue({ ...TEAM_DOC, archivedAt: new Date() });
      await expect(call('documentArchive', { id: DOC.id })).resolves.toMatchObject({
        success: true,
      });
    });

    it('a workspace-level document stays writable by any org member', async () => {
      ctx.prisma.document.findUnique.mockResolvedValue({ ...DOC, teamId: null });
      ctx.prisma.document.update.mockResolvedValue({ ...DOC, teamId: null });
      await expect(call('documentArchive', { id: DOC.id })).resolves.toMatchObject({
        success: true,
      });
    });
  });

  describe('Query.documents archive flag', () => {
    it('hides archived documents unless includeArchived is asked for', async () => {
      ctx.prisma.document.findMany.mockResolvedValue([]);
      await documentResolvers.Query.documents(null, {}, ctx as never);
      const where = (ctx.prisma.document.findMany.mock.calls[0] as [{ where: object }])[0].where;
      expect(where).toMatchObject({ archivedAt: null });
    });
  });

  describe('error mapping', () => {
    it('maps an invalid parent to BAD_USER_INPUT', async () => {
      ctx.prisma.document.findUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          where.id === DOC.id ? { ...DOC, teamId: null } : null,
      );
      await expect(
        call('documentUpdate', { id: DOC.id, input: { parentId: 'missing' } }),
      ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    });
  });

  describe('Mutation.documentUnarchive', () => {
    it('throws NOT_FOUND for a document in another org', async () => {
      ctx.prisma.document.findUnique.mockResolvedValue({ ...DOC, organizationId: 'other' });
      await testAuthGuard(
        documentResolvers.Mutation.documentUnarchive,
        { id: DOC.id },
        ctx,
        'NOT_FOUND',
      );
    });

    it('clears archivedAt and creates a SyncAction', async () => {
      ctx.prisma.document.findUnique.mockResolvedValue({ ...DOC, archivedAt: new Date() });
      ctx.prisma.document.update.mockResolvedValue(DOC);
      const createSyncAction = vi.spyOn(ctx.services.sync, 'createSyncAction');

      const res = await documentResolvers.Mutation.documentUnarchive(
        null,
        { id: DOC.id },
        ctx as never,
      );

      expect(ctx.prisma.document.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { archivedAt: null } }),
      );
      expect(createSyncAction).toHaveBeenCalledWith(TEST_ORG.id, 'U', 'Document', DOC.id, DOC);
      expect(res.lastSyncId).toBe('1');
    });
  });
});
