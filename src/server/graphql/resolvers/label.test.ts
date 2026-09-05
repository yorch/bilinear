import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_LABEL, TEST_TEAM } from '../../../test/fixtures';
import {
  LabelGroupCapacityError,
  LabelGroupDepthError,
  LabelParentNotFoundError,
} from '../../services/label.service';
import { labelResolvers } from './label';

describe('labelResolvers', () => {
  let ctx: MockGraphQLContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('IssueLabel.children', () => {
    it('batches child lookups across labels into one findMany', async () => {
      ctx.prisma.issueLabel.findMany.mockResolvedValue([
        { ...TEST_LABEL, id: 'child-1', parentId: 'p-1' },
        { ...TEST_LABEL, id: 'child-2', parentId: 'p-2' },
      ]);

      const [c1, c2] = await Promise.all([
        labelResolvers.IssueLabel.children({ ...TEST_LABEL, id: 'p-1' } as never, {}, ctx as never),
        labelResolvers.IssueLabel.children({ ...TEST_LABEL, id: 'p-2' } as never, {}, ctx as never),
      ]);

      expect(ctx.prisma.issueLabel.findMany).toHaveBeenCalledTimes(1);
      expect(c1.map(l => l.id)).toEqual(['child-1']);
      expect(c2.map(l => l.id)).toEqual(['child-2']);
    });
  });

  describe('Mutation.issueLabelArchive', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        labelResolvers.Mutation.issueLabelArchive,
        { id: TEST_LABEL.id },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the label does not exist', async () => {
      ctx.prisma.issueLabel.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelArchive,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the team-scoped label team', async () => {
      ctx.prisma.issueLabel.findUnique.mockResolvedValue({ ...TEST_LABEL, teamId: TEST_TEAM.id });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelArchive,
        { id: TEST_LABEL.id },
        ctx,
        'FORBIDDEN',
      );
    });

    it('throws FORBIDDEN when the caller is not owner/admin for a workspace-scoped label', async () => {
      ctx.prisma.issueLabel.findUnique.mockResolvedValue({ ...TEST_LABEL, teamId: null });
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = 'member';

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelArchive,
        { id: TEST_LABEL.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Mutation.issueLabelCreate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        labelResolvers.Mutation.issueLabelCreate,
        { input: { color: '#fff', name: 'Bug' } },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws FORBIDDEN when creating a workspace-scoped label without owner/admin role', async () => {
      // requireOrgRole reads AuthContext.orgRole, resolved once per request by
      // extractAuthContext — there is no second membership lookup to mock.
      ctx.orgRole = 'member';

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelCreate,
        { input: { color: '#fff', name: 'Bug' } },
        ctx,
        'FORBIDDEN',
      );
    });

    it('throws FORBIDDEN when creating a team-scoped label without team membership', async () => {
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelCreate,
        { input: { color: '#fff', name: 'Bug', teamId: TEST_TEAM.id } },
        ctx,
        'FORBIDDEN',
      );
    });

    it('remaps LabelGroupDepthError to BAD_USER_INPUT', async () => {
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });
      vi.spyOn(ctx.services.label, 'create').mockRejectedValue(new LabelGroupDepthError());

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelCreate,
        { input: { color: '#fff', name: 'Bug' } },
        ctx,
        'BAD_USER_INPUT',
      );
    });

    it('remaps LabelParentNotFoundError to NOT_FOUND', async () => {
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({ role: 'owner' });
      vi.spyOn(ctx.services.label, 'create').mockRejectedValue(new LabelParentNotFoundError());

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelCreate,
        { input: { color: '#fff', name: 'Bug', parentId: 'nope' } },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.issueLabelUpdate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        labelResolvers.Mutation.issueLabelUpdate,
        { id: TEST_LABEL.id, input: { name: 'Renamed' } },
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the label does not exist', async () => {
      ctx.prisma.issueLabel.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelUpdate,
        { id: 'missing', input: { name: 'Renamed' } },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws NOT_FOUND for a label belonging to a different org', async () => {
      ctx.prisma.issueLabel.findUnique.mockResolvedValue({
        ...TEST_LABEL,
        organizationId: 'other-org',
      });

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelUpdate,
        { id: TEST_LABEL.id, input: { name: 'Renamed' } },
        ctx,
        'NOT_FOUND',
      );
    });

    it('remaps LabelGroupCapacityError to BAD_USER_INPUT', async () => {
      ctx.prisma.issueLabel.findUnique.mockResolvedValue({ ...TEST_LABEL, teamId: null });
      ctx.prisma.organizationMember.findUnique.mockResolvedValue({ role: 'admin' });
      vi.spyOn(ctx.services.label, 'update').mockRejectedValue(new LabelGroupCapacityError());

      await testAuthGuard(
        labelResolvers.Mutation.issueLabelUpdate,
        { id: TEST_LABEL.id, input: { parentId: 'group-1' } },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Query.labels', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        labelResolvers.Query.labels,
        {},
        createMockContext({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });
  });
});
