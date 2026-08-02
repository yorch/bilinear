import { beforeEach, describe, it, vi } from 'vitest';
import { testAuthGuard } from '../../../test/auth-guard-helper';
import { createMockContext, type MockGraphQLContext } from '../../../test/context-mock';
import { TEST_ISSUE, TEST_ORG, TEST_TEAM, TEST_USER, TEST_USER_2 } from '../../../test/fixtures';
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentReactionNotFoundError,
  CommentService,
  CommentValidationError,
} from '../../services/comment.service';
import { commentResolvers } from './comment';

const TEST_COMMENT = {
  archivedAt: null,
  authorId: TEST_USER.id,
  body: 'hello',
  bodyData: {},
  createdAt: new Date('2026-02-01T00:00:00Z'),
  id: '00000000-0000-0000-0000-000000000600',
  issueId: TEST_ISSUE.id,
  parentId: null,
  resolvedAt: null,
  resolvedById: null,
  updatedAt: new Date('2026-02-01T00:00:00Z'),
};

// `MockGraphQLContext` (src/test/context-mock.ts) doesn't wire up
// `CommentService` — only resolvers that were already under test when that
// mock was built are registered there. Rather than touching shared test
// infra (out of scope for this sweep), build a superset context here that
// adds a real `CommentService` instance over the same mock Prisma client.
type CtxWithComment = MockGraphQLContext & {
  services: MockGraphQLContext['services'] & { comment: CommentService };
};

function createCtx(
  overrides?: Partial<{ orgId: string | null; userId: string | null }>,
): CtxWithComment {
  const base = createMockContext(overrides);
  return {
    ...base,
    services: { ...base.services, comment: new CommentService(base.prisma as never) },
  };
}

describe('commentResolvers', () => {
  let ctx: CtxWithComment;

  beforeEach(() => {
    ctx = createCtx();
  });

  describe('Mutation.commentCreate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        commentResolvers.Mutation.commentCreate,
        { input: { body: 'hi', issueId: TEST_ISSUE.id } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        commentResolvers.Mutation.commentCreate,
        { input: { body: 'hi', issueId: 'missing' } },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when a guest comments on an issue they neither created nor are assigned to', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: TEST_USER_2.id,
        creatorId: TEST_USER_2.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

      await testAuthGuard(
        commentResolvers.Mutation.commentCreate,
        { input: { body: 'hi', issueId: TEST_ISSUE.id } },
        ctx,
        'FORBIDDEN',
      );
    });

    it('remaps CommentValidationError to BAD_USER_INPUT', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(TEST_ISSUE);
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.comment, 'create').mockRejectedValue(
        new CommentValidationError('body too long'),
      );

      await testAuthGuard(
        commentResolvers.Mutation.commentCreate,
        { input: { body: 'hi', issueId: TEST_ISSUE.id } },
        ctx,
        'BAD_USER_INPUT',
      );
    });
  });

  describe('Mutation.commentDelete', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        commentResolvers.Mutation.commentDelete,
        { id: TEST_COMMENT.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the comment does not exist', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue(null);

      await testAuthGuard(
        commentResolvers.Mutation.commentDelete,
        { id: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when the caller is not a member of the comment team', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue({
        teamId: TEST_TEAM.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        commentResolvers.Mutation.commentDelete,
        { id: TEST_COMMENT.id },
        ctx,
        'FORBIDDEN',
      );
    });

    it('remaps CommentForbiddenError to FORBIDDEN when the caller does not own the comment', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue({
        teamId: TEST_TEAM.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.comment, 'delete').mockRejectedValue(new CommentForbiddenError());

      await testAuthGuard(
        commentResolvers.Mutation.commentDelete,
        { id: TEST_COMMENT.id },
        ctx,
        'FORBIDDEN',
      );
    });

    it('remaps CommentNotFoundError to NOT_FOUND', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue({
        teamId: TEST_TEAM.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.comment, 'delete').mockRejectedValue(new CommentNotFoundError());

      await testAuthGuard(
        commentResolvers.Mutation.commentDelete,
        { id: TEST_COMMENT.id },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.commentReactionRemove', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        commentResolvers.Mutation.commentReactionRemove,
        { commentId: TEST_COMMENT.id, emoji: '👍' },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('remaps CommentReactionNotFoundError to NOT_FOUND', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue({
        teamId: TEST_TEAM.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.comment, 'removeReaction').mockRejectedValue(
        new CommentReactionNotFoundError(),
      );

      await testAuthGuard(
        commentResolvers.Mutation.commentReactionRemove,
        { commentId: TEST_COMMENT.id, emoji: '👍' },
        ctx,
        'NOT_FOUND',
      );
    });
  });

  describe('Mutation.commentUpdate', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        commentResolvers.Mutation.commentUpdate,
        { id: TEST_COMMENT.id, input: { body: 'edited' } },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('remaps CommentForbiddenError to FORBIDDEN when the caller does not own the comment', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue({
        teamId: TEST_TEAM.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      vi.spyOn(ctx.services.comment, 'update').mockRejectedValue(new CommentForbiddenError());

      await testAuthGuard(
        commentResolvers.Mutation.commentUpdate,
        { id: TEST_COMMENT.id, input: { body: 'edited' } },
        ctx,
        'FORBIDDEN',
      );
    });
  });

  describe('Query.comment', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        commentResolvers.Query.comment,
        { id: TEST_COMMENT.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the comment does not exist', async () => {
      vi.spyOn(ctx.services.comment, 'findAccessTarget').mockResolvedValue(null);

      await testAuthGuard(commentResolvers.Query.comment, { id: 'missing' }, ctx, 'NOT_FOUND');
    });
  });

  describe('Query.comments', () => {
    it('throws UNAUTHENTICATED when not logged in', async () => {
      await testAuthGuard(
        commentResolvers.Query.comments,
        { issueId: TEST_ISSUE.id },
        createCtx({ orgId: null, userId: null }),
        'UNAUTHENTICATED',
      );
    });

    it('throws NOT_FOUND when the issue does not exist', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue(null);

      await testAuthGuard(
        commentResolvers.Query.comments,
        { issueId: 'missing' },
        ctx,
        'NOT_FOUND',
      );
    });

    it('throws FORBIDDEN when a guest reads comments on an issue they neither created nor are assigned to', async () => {
      ctx.prisma.issue.findUnique.mockResolvedValue({
        ...TEST_ISSUE,
        assigneeId: TEST_USER_2.id,
        creatorId: TEST_USER_2.id,
      });
      ctx.prisma.teamMembership.findUnique.mockResolvedValue({
        team: { organizationId: TEST_ORG.id },
        teamId: TEST_TEAM.id,
        userId: TEST_USER.id,
      });
      ctx.prisma.teamMemberRole.findUnique.mockResolvedValue({ role: 'guest' });

      await testAuthGuard(
        commentResolvers.Query.comments,
        { issueId: TEST_ISSUE.id },
        ctx,
        'FORBIDDEN',
      );
    });
  });
});
